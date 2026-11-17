> 中文阅读版。以英文原文 docs/reference/export-formats.md 为准。

<!-- source-blob: 60e079e2ce9b3985eb557ad267e1244b37c86f39 -->

# 导出格式

读者对象：使用其他工具读取 Estela 导出文件的人，或修改导出代码的人。本文档列出 `estela export-atif` 和 `estela export-otlp` 如何将会话映射到各自格式。对应代码为 `packages/kernel/src/export-atif.ts`、`export-atif-steps.ts` 和 `export-otlp.ts`；命令运行方式见[报告与导出](../guide/exports.zh-CN.md)。

以下两条规则同时适用于两种格式：

- 代理未记录的值会省略，从不写成零或猜测。唯一例外是 ATIF 必填的 `agent.version`，当日志未记录代理版本时填为 `"unknown"`。
- 被上下文压缩移除的事件不生成 ATIF 步骤。在 OTLP 中它们仍保留各自的 `chat` 和 `execute_tool` span，但之后所有请求的 `gen_ai.input.messages` 都不再包含它们。

## 固定版本

| 格式 | 版本 | 固定位置 | 稳定性 |
|---|---|---|---|
| ATIF | `ATIF-v1.8`（[Harbor RFC 0001](https://github.com/harbor-framework/harbor/blob/main/rfcs/0001-trajectory-format.md)） | `export-atif.ts` 中的 `ATIF_SCHEMA_VERSION` | 从 1.0 起纳入 semver 覆盖范围（见[公共接口](public-interface.zh-CN.md)） |
| OTLP | 携带 `gen-ai-dev/1.42.0-dev` OpenTelemetry GenAI 属性的 OTLP/JSON `ExportTraceServiceRequest` | `export-otlp.ts` 中的 `OTLP_SEMCONV_VERSION` | 实验性：GenAI 语义约定尚未发布正式版，因此当固定版本移动时属性名可能会改变 |

采用新的 ATIF 或语义约定版本属于有意变更，会在单独的改动中同步更新版本号常量、本文档以及测试。

## ATIF

一次导出对应一条主代理的根轨迹。至少包含一个可导出事件的每条子代理泳道都会以相同方式构建为根轨迹 `subagent_trajectories` 中的一项。

### 轨迹

| 字段 | 值 |
|---|---|
| `schema_version` | `ATIF-v1.8` |
| `session_id` | 会话 id |
| `trajectory_id` | 仅在内嵌的子代理轨迹上存在：泳道 id |
| `agent.name` | 代理 id（`claude-code`、`codex` 等） |
| `agent.version` | 日志记录的代理版本，否则为 `"unknown"` |
| `agent.model_name` | 当轨迹中注明模型的请求全部使用同一个模型时，为该模型名称 |
| `agent.tool_definitions` | 会话的工具列表（仅在根轨迹上，且该列表为对象列表时） |
| `steps` | 见下文；`step_id` 从 1 开始递增 |
| `notes` | 固定说明：导出源、`extra.estela.eventIds` 列出每个步骤的事件、上下文压缩规则，以及 `cost_usd` 为目录价 |
| `final_metrics` | `total_prompt_tokens`、`total_completion_tokens`、`total_cached_tokens`（记录了相应字段的步骤之和）、`total_steps` 和 `total_cost_usd`（见下文） |
| `extra.estela`（仅根轨迹） | `capabilities`、`skipped`（读取器跳过的日志记录按原因统计的数量）、`pricing`（见下文），以及出现在任何步骤之前的钩子、未知事件、轮次时长和提示词快照条目 |

### 步骤

泳道上的事件按顺序读取。user 事件、compaction 事件，以及会单独生成步骤的 system 事件（文本，或带有新系统提示词的提示词快照）会关闭当前打开的 agent 步骤；不生成步骤的 system 事件（轮次时长、未变化的提示词快照）以及 hook 和 unknown 事件不会关闭它。具有相同 `requestId` 的代理事件（`assistant`、`reasoning`、`tool_call`、`request`）合并为一个 agent 步骤。

| 事件 | ATIF |
|---|---|
| 会话或泳道的系统提示词 | 首个带有该文本的 `system` 步骤 |
| `user` | 一个 `user` 步骤；`message` 为其文本（无文本时为空字符串）；标志 `meta`、`compactSummary`、`command`、`injected`、`continued` 写入 `extra.estela.flags` |
| `assistant` | agent 步骤的 `message`（多段文本以空行连接） |
| `reasoning` | agent 步骤的 `reasoning_content` |
| `tool_call` | `tool_calls[]`：`tool_call_id`、`function_name`、`arguments`（记录的对象；其他任何值包装为 `{ "input": … }`）；工具标题写入该调用的 `extra.estela.title` |
| `tool_result` | 写入持有其调用的步骤上的 `observation.results[]`，带 `source_call_id`；`content` 为输出文本，非文本时为其 JSON；`isError`、`exitCode` 和 `orphan` 写入该结果的 `extra.estela`。轨迹中没有对应调用的结果不含 `source_call_id` |
| `request` | agent 步骤的 `metrics`（见下文），以及当模型与 `agent.model_name` 不同时的 `model_name` |
| `compaction` | 一个 `system` 步骤，其 `message` 为压缩摘要（未记录摘要时为 `Context compaction performed`），有摘要时同时将其作为 `observation.results[0].content`。当压缩记录了 `trigger`、`preTokens` 或 `postTokens` 时，它们写入 `extra.estela.compaction` 且该步骤携带 `extra.context_management = { "type": "compaction", "boundary": "replace" }`；未记录上述任一项的压缩不含 `extra.context_management` |
| 带有新系统提示词的提示词快照 | 一个带有该文本的 `system` 步骤；未变化时仅将其 id 添加到当前打开步骤的 extras |
| 带有文本的 `system` 事件 | 一个 `system` 步骤 |
| 轮次时长 | 当前打开步骤的 `extra.estela.turnDurationMs` |
| `hook`、`unknown` 及其他 `system` 事件 | 不生成步骤；列在当前打开步骤的 `extra.estela.hooks` 或 `extra.estela.unknown` 中 |
| 被上下文压缩隐藏的事件 | 不生成步骤 |
| 所在泳道上后续有上下文压缩的用户或代理步骤 | `is_copied_context: true` |
| 每个步骤 | `extra.estela.eventIds`（规范事件 id；初始系统提示词步骤为空数组），分组时还包含 `extra.estela.requestId`。user 和 agent 步骤带有 `timestamp`（ISO 8601，取其首个事件的时间）；system 步骤（包括上下文压缩步骤）不含时间戳 |

启动子代理的步骤会在 `observation.results[]` 中获得一项 `subagent_trajectory_ref: [{ trajectory_id: <lane id>, session_id }]`（当启动事件为工具调用时还带有该调用的 `source_call_id`）。没有任何可导出事件的子代理泳道会被省略，其引用也一并省略。

没有任何用户、代理或系统提示词内容的 trace 无法生成步骤，导出会以该原因失败。

### 指标与费用

| 请求字段 | ATIF |
|---|---|
| `usage.inputTokens`（包含缓存读取和写入） | `metrics.prompt_tokens` |
| `usage.outputTokens` | `metrics.completion_tokens` |
| `usage.cacheReadTokens` | `metrics.cached_tokens` |
| `usage.cacheWriteTokens`、`cacheWrite1hTokens`、`reasoningTokens`、`totalTokens`、`granularity`、`modelCalls`、`responseId` | `metrics.extra.estela` |
| 当 `granularity` 为 `turn` 或 `session` 时的 `modelCalls` | `llm_call_count` |
| 请求的目录价 | `metrics.cost_usd`，仅当该请求已计价时 |

仅当该轨迹所在泳道的每一个请求均已计价时，才设置 `final_metrics.total_cost_usd`；按 ATIF 的定义，根轨迹覆盖整个会话（包含子代理）。被上下文压缩隐藏的请求虽然不生成步骤，也计入此规则。根轨迹的 `extra.estela.pricing` 为 `{ "version": <price snapshot version>, "unpricedRequests": <count> }`。计价规则见[费用](../guide/workspace.zh-CN.md#费用)。

## OTLP

导出文件是一份 OTLP/JSON `ExportTraceServiceRequest`，包含一个 `resourceSpans`（资源属性 `service.name = "estela"`）和一个 `scopeSpans`（scope `estela`）。文件遵循 OTLP JSON 编码：span kind 为整数，trace id 和 span id 为十六进制字符串，时间为十进制字符串表示的纳秒时间戳。id 根据代理、会话、泳道和事件 id 哈希生成，因此同一会话每次导出都会得到相同的 id。

| 来源 | Span 与属性 |
|---|---|
| 每条有事件的泳道 | `invoke_agent <name>`（kind INTERNAL）：`gen_ai.operation.name = "invoke_agent"`、`gen_ai.agent.name`（主泳道为代理 id，子代理为泳道标题）、`gen_ai.agent.version`（有记录时）、`gen_ai.conversation.id`（会话 id）。子代理 span 的父 span 为其启动事件的 span（存在时），否则为其父泳道的 span。时间范围从泳道的第一个事件持续到最后一个事件 |
| 每个 `request` | `chat <model>`（kind CLIENT），为其泳道 span 的子 span：`gen_ai.operation.name = "chat"`、`gen_ai.request.model`、`gen_ai.response.id`、`gen_ai.response.finish_reasons`，各有记录时写入。开始时间为记录的开始时间，否则为事件时间；结束时间为开始时间加上记录的时长 |
| 请求的用量 | `gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、`gen_ai.usage.cache_read.input_tokens`、`gen_ai.usage.cache_write.input_tokens`、`gen_ai.usage.reasoning.output_tokens`，各有记录时写入。在固定版本的注册表中总 Token 数没有对应属性，因此省略 |
| 请求时模型所见的内容（`reconstruct`） | `gen_ai.input.messages`（可见的用户、回复、系统文本、推理、工具调用和工具结果事件，格式为 GenAI 消息）、`gen_ai.system_instructions` 和 `gen_ai.tool.definitions`，均为 JSON 字符串，仅在有记录时写入 |
| 请求自身的输出事件 | `gen_ai.output.messages`（JSON 字符串） |
| 同泳道此前发生过上下文压缩 | `gen_ai.conversation.compacted = true` |
| 每个 `tool_call` | `execute_tool <name>`（kind CLIENT），存在对应请求时为其 `chat` span 的子 span，否则为泳道 span 的子 span：`gen_ai.tool.name`、`gen_ai.tool.call.id`、`gen_ai.tool.call.arguments` 和 `gen_ai.tool.call.result`（JSON 字符串）。带有 `isError` 的结果将 span 状态设为 ERROR。结束时间为工具结果的时间 |
| `system`、`hook`、`unknown`、`compaction` 事件及跳过的记录 | 不生成 span |

OTLP 导出不包含费用：固定版本的语义约定未定义费用属性。

## 检查

- `packages/kernel/src/export-atif.test.ts`、`export-atif-cost.test.ts` 和 `export-otlp.test.ts` 在合成 trace 上测试映射逻辑。
- `apps/cli/src/export/write-export.test.ts` 在 CI 中对示例 trace 以及每个已注册代理的一致性测试夹具执行导出，并通过结构化 ATIF 检查。
- `node scripts/validate-exports.mjs` 导出相同夹具并运行 Harbor 的校验器（`python -m harbor.utils.trajectory_validator`，需通过 uv 使用 Python 3.12）。该检查需要联网，仅手动运行，不在 CI 中执行。
