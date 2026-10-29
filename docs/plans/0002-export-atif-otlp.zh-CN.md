> 中文阅读版。以英文原文 docs/plans/0002-export-atif-otlp.md 为准。

# Plan 0002: 将 trace 导出为 ATIF 与 OTLP

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-10-27
- Paired Spec: [`docs/specs/0002-export-atif-otlp.zh-CN.md`](../specs/0002-export-atif-otlp.zh-CN.md)

本计划实现已归档外部发布计划（第 7 节）的两个导出后续：canonical trace 的
一个 ATIF v1.8 投影和一个 OTLP 投影，各自由一个 CLI 命令承载：加载会话、
脱敏、写入一个文件。对应 issue #50（ATIF）与 #51（OTLP）。

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Rollout and stability
5. Verification
6. Execution plan
7. Risks, open questions, and follow-up

## 1. Background and goals

### 1.1 Current behavior and constraints

- canonical trace（`@rivus/agent-trace-schema`）是带 per-kind payload 的事件
  列表；kit 的 payload 注释写明每个字段对应的 OTel GenAI 属性
  （`gen_ai.request.model`、`gen_ai.usage.input_tokens`……）。
  `reconstruct(trace, eventId)` 是一个事件处的模型可见面：system、tools、
  summary、messages、currentTurn 各槽位。
- kernel 与 schema 在测试外不 import `node:*`，且除 `apps/cli` 外任何
  workspace package 运行时不 import kit。
- Harbor 的 ATIF 校验器（`src/harbor/utils/trajectory_validator.py`，
  `python -m harbor.utils.trajectory_validator`）用 Pydantic 模型检查
  ATIF v1.8：禁止多余字段、`step_id` 从 1 连续、`source_call_id` 必须引用
  同一 step 的 `tool_call_id`、agent 专有 step 字段不得出现在 system/user
  step、内嵌 subagent 需要唯一 `trajectory_id`。Harbor 要求 Python >= 3.12。
- OTel GenAI 语义约定尚无 release。撰写时
  `open-telemetry/semantic-conventions-genai` 的 `main` 的 schema URL 仍是
  `gen-ai-dev/1.42.0-dev`，与已归档计划固定的版本一致。
- 三个后端都接入 OTLP/JSON span 并映射 GenAI 约定：Langfuse 读取
  `gen_ai.input.messages` / `gen_ai.output.messages` /
  `gen_ai.system_instructions` / `gen_ai.tool.definitions` /
  `gen_ai.usage.*`，并从 `gen_ai.operation.name` 推断 observation 类型
  （`chat` → generation、`execute_tool` → tool、`invoke_agent` → agent）；
  Phoenix 在接入时把同样的属性转换为 OpenInference，并从
  `gen_ai.operation.name` 推断 span kind；LangSmith 读取相同的消息属性与
  `gen_ai.usage.*`，外加旧版 span event。三者都接受 OTLP HTTP/JSON traces
  端点。
- 脱敏是 kit 的 `redact` / `redactText`，由 `apps/cli` import。

### 1.2 Problem

trace 只能被查看，不能被带走。canonical 模型当初就是为这两个导出设计的
（已归档计划的 D3：字段含义跟随 OTel GenAI；结构保持可映射到 ATIF），所以
两者都是投影——但都还不存在。

### 1.3 Goals and success criteria

- 每个已注册 agent 的每个 fixture 会话都导出为通过 Harbor 校验器的 ATIF
  v1.8 文档（Spec A2）。
- 导出的 fixture trace 可解码为 `ExportTraceServiceRequest`（A4），并能在
  Langfuse、LangSmith、Phoenix 中打开（A5）。
- 本计划的映射表固定 ATIF v1.8 与 `gen-ai-dev/1.42.0-dev`。
- 所有仓库门禁保持绿色；导出器不给 kernel 增加任何 `node:*` import。

### 1.4 Non-goals

- 任一格式的浏览器导出动作或 RPC。
- CLI 向远端端点发送数据。
- 把 ATIF 或 OTLP 导入回 trace。
- `dsh` 或 OpenCode 导出。
- 对 token 或时间数据做舍入；总量保持原样。

## 2. Outline

### 2.1 Design principles

- 导出是投影：纯函数，对每个合法 `Trace` 全定义，无 I/O。
- 缺失即省略，从不发明（唯一例外：ATIF `agent.version` 必填，未记录时取
  `"unknown"`）。
- 每条导出内容都指名它来自哪些事件。

### 2.2 Boundaries and responsibilities

| Piece | Package | Owns |
|---|---|---|
| ATIF 投影 | `packages/kernel`（`export-atif.ts`） | `Trace` → ATIF v1.8 trajectory 对象 |
| OTLP 投影 | `packages/kernel`（`export-otlp.ts`） | `Trace` → OTLP/JSON `ExportTraceServiceRequest` 对象 |
| 确定性 id | `packages/kernel`（`hash-id.ts`） | 基于 FNV-1a 的 hex id，供 span/trace id 使用 |
| 加载、脱敏、写入、终端输出 | `apps/cli`（`export.ts`、`main.ts`、`argv.ts`） | `export-atif` / `export-otlp` 命令 |
| Fixture 校验脚本 | `scripts/validate-exports.mjs` | 导出 fixture，运行 Harbor 校验器 |

## 3. Detailed design

### 3.1 Entry points

```
npx @rivus/agent-trace export-atif <path> [--out <file>]
npx @rivus/agent-trace export-otlp <path> [--out <file>]
```

`<path>` 与 `build` 接受的相同：canonical agent-trace JSON 文件或会话路径。
`--out` 写入该文件（创建或截断）；省略时写入工作目录下的
`agent-trace-<session id 前 8 字符>.atif.json` / `.otlp.json`。plain 模式下
输出一行（`Wrote <path>`，home 用 `~`）；否则 clack intro/outro。

### 3.2 Kernel interfaces

```ts
// packages/kernel: two pure projections
export function toAtif(trace: Trace): AtifTrajectory
export function toOtlp(trace: Trace): OtlpExportTraceRequest
```

两者都接受检查过的 `Trace`，返回普通对象；CLI 用
`JSON.stringify(value, null, 2)` 序列化。类型（`AtifTrajectory`、`Otlp…`）
与导出器同文件，只镜像导出会设置的外部 schema 字段；它们不是 schema，
也没有任何代码把这些文档解析回来。

`hash-id.ts` 提供不依赖 `node:crypto` 的确定性 id：两个加盐 FNV-1a 64 位
哈希拼接为 16 字节 hex trace id，一个为 8 字节 span id。相同 trace 输入
得到相同 id。

### 3.3 ATIF 映射（固定：ATIF v1.8，Harbor RFC 0001）

根文档：

| Canonical | ATIF |
|---|---|
| `session.id` | `session_id`；内嵌 subagent 上也是 `trajectory_id`（lane id） |
| `agent`, `agentVersion` | `agent.name`, `agent.version`（未记录时 `"unknown"`） |
| `session.systemPrompt`, `session.tools` | 第一个 `system` step 的 `message`；`agent.tool_definitions`（仅当为记录数组） |
| request `model` 恰有一个不同值 | `agent.model_name` |
| `skipped`, `capabilities`, `agents`, `source`, `original` | `extra.agent_trace`（skipped 按 reason 计数；capabilities；无 per-event 内容——`source`/`original` 不放入） |
| — | `notes`：写明本映射的 producer note |

Steps（主 lane 按 `seq` 顺序走 `events`；其余每条 lane 成为一条按同样方式
构建的内嵌 `subagent_trajectories`）：

| Canonical | ATIF |
|---|---|
| `user` 事件 | `source: "user"` 的 step，`message` = `payload.text`（缺失时为空串）；`meta`/`injected`/`command`/`continued`/`compactSummary` 标志 → `extra.agent_trace.flags` |
| 该 lane 上一个 `requestId` 组（`assistant`、`reasoning`、`tool_call`、`tool_result`、带该 id 的 `request`） | 一个 `source: "agent"` 的 step |
| `assistant` payload `text` | `message` |
| `reasoning` payload `text`（空行连接） | `reasoning_content` |
| `tool_call`（`callId`, `name`, `args`） | `tool_calls[]`：`tool_call_id`, `function_name`, `arguments`（`args` 为记录时用之，否则 `{}`）；`title` → `extra.agent_trace.title` |
| `tool_result`（`callId`, `output`） | 进入持有匹配 `tool_call` 的 step 的 `observation.results[]`（`source_call_id`, `content` = `output` 为字符串时用之，否则 JSON 文本）；orphan result → 当前 agent step 上省略 `source_call_id` |
| `request` payload | `metrics`：`prompt_tokens` = `usage.inputTokens`, `completion_tokens` = `usage.outputTokens`, `cached_tokens` = `usage.cacheReadTokens`；`metrics.extra.agent_trace`：`cacheWriteTokens`, `reasoningTokens`, `totalTokens`, `cacheWrite1hTokens`, `granularity`, `modelCalls`, `responseId`；`model_name` = `payload.model`（与 `agent.model_name` 不同时）；granularity 为 `turn`/`session` 时 `llm_call_count` = `modelCalls` |
| `compaction` 事件 | `system` step，`message` = summary 文本（`payload.summaryEventId` 指名的 `compactSummary` user 事件，否则 `"Context compaction performed"`），`observation.results[0].content` = 该 summary，`extra.context_management = { type: "compaction", boundary: "replace" }`，`extra.agent_trace` 带 `trigger`/`preTokens`/`postTokens` |
| 跨 compaction 保留的事件（在它之前且未被 `shadowedBy`） | 其 step 带 `is_copied_context: true` |
| 被 compaction `shadowedBy` 的事件 | 不产生 step |
| `system` 事件 `type: 'prompt_snapshot'` 带 `systemPrompt` | `message` 为该快照文本的 `system` step（第一份与 `session.systemPrompt` 相同则复用之） |
| `system` 事件 `type: 'turn_duration'` | 不产生 step；`durationMs` → 进行中 step 的 `extra.agent_trace.turnDurationMs` |
| `hook` / `unknown` 事件 | 不产生 step；收集进进行中 step 的 `extra.agent_trace.hooks` / `.unknown` |
| `ts` | `timestamp`（ISO 8601） |
| `durationMs`, `skipped`, `source`, `original`, `requestId`, `agentId` | `extra`（`extra.agent_trace.eventIds` 写明 step 的事件；`requestId` 在 step 的 `extra.agent_trace` 上） |

Step 分组规则：lane 的遍历在第一个带 `requestId` 的事件（或未分组的
`assistant`/`tool_call`/`reasoning`）处打开一个 agent step，持续吸收该
`requestId`（或未分组消息 kind）的事件，在下一个 `user`/`system`/
`compaction` 事件或新 `requestId` 处关闭。没有 `request` 事件的 step 没有
`metrics`。`llm_call_count` 只取自记录的 `modelCalls`。`final_metrics` 对
根 step 的 `metrics` 求和（`total_prompt_tokens`、`total_completion_tokens`、
`total_cached_tokens`、`total_steps`）。

Subagents：带 `parentId` 的 lane 成为内嵌 trajectory（`trajectory_id` =
lane id，`agent.name` = `trace.agent`，`session_id` = `session.id`）；持有
spawn 事件所在 lane 的 step 将 `spawnEventId` 分组进自己，其
`observation.results` 增加 `subagent_trajectory_ref:
[{ trajectory_id: <lane id>, session_id }]` 一项。

### 3.4 OTLP 映射（固定：semconv `gen-ai-dev/1.42.0-dev`）

一个 `resourceSpans`，resource 属性 `service.name = "agent-trace"`；一个
`scopeSpans`，scope 为 `agent-trace`。JSON 遵循 OTLP JSON 编码规则：枚举用
整数（`span_kind`）、hex `traceId`/`spanId`、纳秒时间为十进制字符串。

Id 与时间：trace id = `agent + session.id` 的哈希；span id = 事件 id 的
哈希（`invoke_agent` span：lane id 的哈希）。start = `startedAt` 或 `ts`
（epoch ms → 纳秒）；end = start + `durationMs`，否则该 lane 上下一个事件的
`ts`（不超过父 span 的 end），否则 start。

| Canonical | Span / attribute |
|---|---|
| session（主 lane） | 根 span `invoke_agent {agent.name}`，`gen_ai.operation.name = "invoke_agent"`，`gen_ai.agent.name`，记录了 `gen_ai.agent.version` 则带上；subagent lane 各有自己的 `invoke_agent` span，父为 spawn event 的 span（可解析时），否则根 |
| `request` 事件 | span `chat {model}`，`gen_ai.operation.name = "chat"`，span kind CLIENT，父 = 该 lane 的 `invoke_agent` span；`gen_ai.request.model`, `gen_ai.response.id`, 记录了 finishReason 时 `gen_ai.response.finish_reasons = [finishReason]` |
| `request.usage` | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens`, `gen_ai.usage.reasoning.output_tokens`；`totalTokens` → `gen_ai.usage.total_tokens`？不——pinned registry 中没有；省略 |
| lane 上在 request 之前有 compaction 的 `request` | `gen_ai.conversation.compacted = true` |
| `reconstruct(trace, request.id)` | `gen_ai.input.messages`（可见 messages 槽位的 JSON 字符串：`user` → role user，`assistant` → role assistant，`tool_call` → 带 `tool_call` part 的 role assistant，`tool_result` → 带 `tool_call_response` part 的 role tool，`reasoning` → 带 `reasoning` part 的 role assistant）、`gen_ai.system_instructions`（JSON 字符串，取 `system` 槽位快照或 session/lane 字段）、`gen_ai.tool.definitions`（JSON 字符串，取 `tools` 槽位） |
| 该 lane 上带此 request `requestId` 的事件 | `gen_ai.output.messages`（JSON 字符串：`assistant` 事件的文本与 `reasoning` 文本作为 parts，`tool_call` 作为 `tool_call` parts） |
| `tool_call` 事件（及其 `tool_result`） | span `execute_tool {name}`，`gen_ai.operation.name = "execute_tool"`，`gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result`（记录时结构化，否则 JSON 文本），父 = 产生它的 request 的 `chat` span（可解析时）；`tool_result.isError` → span status ERROR |
| `system` 事件、`hook`、`unknown`、`compaction`、`skipped` | 不产生 span；compaction 以其后继 request 上的 `gen_ai.conversation.compacted` 呈现 |

属性值遵循 pinned registry 的类型：字符串、整数、布尔、字符串数组，以及
registry 允许 any 处的结构化值（`kvlistValue` / JSON 字符串）。

### 3.5 Redaction

CLI 在写入前对导出的对象树应用 kit 的 `redact`（仅字符串：home 目录 → `~`、
已知 token 模式），除非 `AGENT_TRACE_REDACT=0`。report 的规则（始终脱敏）
仍是 report 专有：数据导出可关闭，因为数据集或后端接入可能合法地需要未脱敏
的字节。

### 3.6 Failures and recovery

| Condition | Behavior |
|---|---|
| 加载失败 | 退出 1，加载错误的 message（已脱敏），不写文件 |
| 零 step 的 trace（无可导出事件） | ATIF 要求至少一个 step：导出写入一个携带 `session.systemPrompt` 的 `system` step；trace 中一个都没有时以说明性 message 失败 |
| `--out` 不可写 | 退出 1 并给出 IO 错误的 message |

### 3.7 Compatibility and migration

只有新命令与 kernel 导出；没有任何东西改变形态。`@rivus/agent-trace` 上的
changeset（minor）记录新能力。

## 4. Rollout and stability

本地工具：随下一版本发布，无阶段。回滚即 revert PR。信号是仓库检查与校验
脚本。

## 5. Verification

- Kernel 单元测试：`export-atif.test.ts`（根文档、step 分组、compaction、
  subagents、metrics、不变量——step id 连续、`source_call_id` 可解析、
  agent 专有字段只出现在 agent step、内嵌 `trajectory_id` 唯一）与
  `export-otlp.test.ts`（span 树、属性名与值、OTLP JSON 编码规则、来自
  `reconstruct` 的消息）。
- CLI 测试：`export.test.ts` —— demo fixture 上的命令接线（文件写出、应用
  脱敏、`AGENT_TRACE_REDACT=0` 保留内容），以及每个已注册 agent 的
  conformance fixture 各一次导出并跑结构化 ATIF 检查器，使 CI 无 Python 也
  覆盖 A2 的形态。
- `scripts/validate-exports.mjs`：用 CLI 导出每个已注册 agent 的 fixture
  会话，并对每个输出运行 Harbor 校验器（`uv run --python 3.12 --with harbor
  python -m harbor.utils.trajectory_validator <file>`）；手动门禁，输出附于
  交付 PR。
- 后端接入（Spec A5）：把导出的 fixture POST 到本地 Phoenix
  （`arize-phoenix`）与本地 Langfuse；LangSmith 需要云端 API key，若无 key
  可用，其接入按其文档化映射验证并在 PR 中标为 skipped-with-reason。

### 5.1 Validation ledger

| Batch | Command or evidence | Expected result |
|---|---|---|
| kernel | `pnpm --filter @rivus/agent-trace-kernel test` | exporter 单元测试绿色 |
| cli | `pnpm --filter @rivus/agent-trace test` | export 接线 + fixture 导出绿色 |
| validator | `node scripts/validate-exports.mjs` | 每个 fixture 导出都通过 Harbor 校验器 |
| backends | PR evidence：Phoenix + Langfuse 接入输出 | 会话可见，含 model、messages、usage |
| gates | `node scripts/format.mjs --check`, `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `node scripts/check-layers.mjs`, `node scripts/check-browser-bundle.mjs` | 全绿 |

## 6. Execution plan

### 6.1 Preconditions

Paired Spec 已评审；实现时复核第 3 节固定的 `harbor` 与 semconv 版本。

### 6.2 Completion contract

Spec A1–A4 有测试；A2 与 A5 有记录的证据；映射表写明 ATIF v1.8 与
`gen-ai-dev/1.42.0-dev`；所有门禁绿色。

### 6.3 Execution order

1. Kernel：`hash-id.ts`、`export-atif.ts`、`export-otlp.ts` + 测试。
2. CLI：`argv.ts` 命令、`export.ts`、`main.ts` 接线、终端行、
   `export.test.ts`。
3. `scripts/validate-exports.mjs`，运行并记录证据。
4. 文档：README 命令、`AGENTS.md` kernel 行、本计划的 ledger。
5. Changeset；运行所有门禁；提交。

### 6.4 Rollback per batch

Revert PR；除用户写出的导出文件外无持久数据。

## 7. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step |
|---|---|---|---|---|
| GenAI semconv 无 release；名称可能变化 | risk | 映射表过时 | unconfirmed | 表格固定 `gen-ai-dev/1.42.0-dev`；semconv 发版时用专门 PR 更新 |
| Langfuse/LangSmith 映射漂移（其接入独立演进） | risk | 某后端显示的字段变少 | unconfirmed | 导出保持 pinned registry 名称；缺口向上游反馈 |
| Harbor 校验器要求 Python >= 3.12 | risk | 校验器运行需要 uv | unconfirmed | 脚本文档化命令；CI 不运行它 |
| ATIF `extra` 随 agent 专有 payload 字段增长 | follow-up | 导出变大 | unconfirmed | 只保留 3.3 列出的字段；扩展需专门决定 |
| 流式或增量导出 | follow-up | 超大会话 | unconfirmed | 需要时另立计划 |
