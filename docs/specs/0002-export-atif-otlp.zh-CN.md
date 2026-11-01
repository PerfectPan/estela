> 中文阅读版。以英文原文 docs/specs/0002-export-atif-otlp.md 为准。

# Spec 0002: 将 trace 导出为 ATIF 与 OTLP

## Status

Draft

Paired Plan: [`docs/plans/0002-export-atif-otlp.zh-CN.md`](../plans/0002-export-atif-otlp.zh-CN.md)

## Problem And Scope

canonical trace 无法离开本工具：接受 Agent Trajectory Interchange Format
（ATIF v1.8）的工具（例如 Harbor 的评测与数据集），以及接入 OpenTelemetry
的追踪后端（Langfuse、LangSmith、Phoenix）都没有导入路径。本 Spec 为
canonical trace 增加两个导出投影，各对应一个写入单个文件的 CLI 命令：

- `export-atif` 将 trace 写为一个 ATIF v1.8 trajectory 文档，字段映射遵循
  已归档的外部发布计划的附录 A.8；ATIF 没有位置存放的字段进入 `extra`。
- `export-otlp` 将 trace 写为一个 OTLP/JSON `ExportTraceServiceRequest`，
  其 span 携带 OpenTelemetry GenAI 语义约定属性；映射表固定所映射的
  semconv 版本。

不包括：不做 UI 导出动作，不加 RPC，CLI 不向远端端点发送数据（由用户自行
上传文件），不做 ATIF 或 OTLP 的导入，不做流式或增量导出，不新增 package。

## Behavioral Requirements

- `agent-trace export-atif <path> [--out <file>]` 与
  `agent-trace export-otlp <path> [--out <file>]` 只加载一次 `path` 处的
  会话（canonical agent-trace JSON 文件，或已注册 agent 适配器接受的会话
  路径），并把导出写入 `--out`；省略 `--out` 时写入工作目录下的
  `agent-trace-<session id 前 8 个字符>.atif.json` / `.otlp.json`。成功时
  命令打印写入的路径（home 目录用 `~` 表示）并以 0 退出。加载失败时以 1
  退出并给出加载错误的 message。
- ATIF 导出是符合 ATIF v1.8 的文档：`schema_version`、`agent`（`name`、
  `version`）、`step_id` 从 1 开始连续编号的 `steps` 数组，以及内嵌的
  `subagent_trajectories`（每项自身也是合法 trajectory，且 `trajectory_id`
  唯一）。
- 被compaction 移除的事件（`shadowedBy`）不产生 ATIF step。跨 compaction
  保留的事件产生的 step 标记 `is_copied_context: true`，compaction 本身产生
  一个 `system` step，其 `extra.context_management` 为
  `{ type: "compaction", boundary: "replace" }`。
- subagent lane 成为一条内嵌 `subagent_trajectories`，其 spawn 事件的 step
  在 `observation.results[]` 中携带一条 `subagent_trajectory_ref`，可解析到
  该内嵌 trajectory（`trajectory_id`）。
- OTLP 导出是一个 OTLP/JSON `ExportTraceServiceRequest`，其 span 携带固定
  semconv 版本（`gen-ai-dev/1.42.0-dev`）的 OpenTelemetry GenAI 属性：每个
  model request 一个 `chat` span，带 `gen_ai.request.model`、
  `gen_ai.response.id`、`gen_ai.response.finish_reasons` 与 agent 记录的
  `gen_ai.usage.*` 计数；每次 tool call 一个 `execute_tool` span，带
  `gen_ai.tool.name` 与 `gen_ai.tool.call.id`；每个 agent lane 一个
  `invoke_agent` span；每个 request 以 `gen_ai.input.messages` /
  `gen_ai.output.messages`（JSON 字符串）携带模型可见消息，以
  `gen_ai.system_instructions` / `gen_ai.tool.definitions` 携带记录的
  system prompt 与工具列表，compaction 之后的 request 带
  `gen_ai.conversation.compacted: true`。
- 每种格式的映射表写明映射到的外部版本：ATIF v1.8，以及 OTel GenAI semconv
  schema 版本 `gen-ai-dev/1.42.0-dev`。属性名与字段名与该版本完全一致。
- agent 未记录的字段在导出中省略，不置零、不发明；唯一例外是 `agent.version`：
  日志未记录 agent 版本时取 `"unknown"`，因为 ATIF 必填该字段。
- 两个导出默认都做脱敏，无论来源：使用与 report 相同的脱敏
  （`AGENT_TRACE_REDACT=0` 可关闭）。到达终端的错误保持 shell 已有的脱敏。
- 单元测试在合成 trace 上覆盖映射规则，且每个已注册 agent 的 fixture 会话
  导出的文档通过该格式的结构检查。

## Domain Invariants

- 导出器是 kernel 中对 `Trace` 的纯投影：不 import `node:*`，无 I/O，运行时
  不 import kit。CLI 负责加载、脱敏、写入。
- 缺失即 `unavailable`：agent 未记录的内容在导出中省略。导出器从不估算或
  默认任何一个计数、时间或文本。
- 每条导出的事实都可追溯到其来源事件：ATIF step 在
  `extra.agent_trace.eventIds` 中写明自己的 canonical event id。
- 未知数据在加载时大声失败，与其他地方一致；导出器只看到检查过的 `Trace`。

## Acceptance Examples

### A1: Demo fixture 导出为合法 ATIF

- Given demo fixture `fixtures/demo.trace.json`，
- When 用 `export-atif` 导出，
- Then 文档通过 Harbor 的 ATIF 校验器
  （`python -m harbor.utils.trajectory_validator`），compaction 是带
  `extra.context_management` 的 system step，被其 shadow 的事件不产生
  step，保留的 pre-compaction step 带 `is_copied_context: true`。

### A2: 每个已注册 agent 的 fixture 都导出为合法 ATIF

- Given 每个已注册 agent（claude-code、codex、dsh、grok、opencode、pi）的 conformance fixture
  会话，
- When 逐个用 `export-atif` 导出，
- Then 每个文档都通过 Harbor 的 ATIF 校验器。

### A3: Subagent 内嵌导出且可被引用

- Given 带 subagent lane 的 fixture 会话，
- When 用 `export-atif` 导出，
- Then 根 trajectory 携带 `subagent_trajectories`，每条 lane 一个内嵌
  trajectory，`trajectory_id` 唯一，且 spawn step 的 `observation` 以
  `trajectory_id` 引用它。

### A4: OTLP 导出可按 OTLP/JSON 解码

- Given 任意 fixture 会话，
- When 用 `export-otlp` 导出，
- Then 文件按 OTLP JSON 编码规则（整数枚举、hex id、字符串纳秒时间）解码为
  `ExportTraceServiceRequest`，且 chat span 携带固定的 `gen_ai.*` 属性及其
  在 trace 中记录的值。

### A5: OTLP 导出可在 Langfuse、LangSmith、Phoenix 中打开

- Given 一个导出的 fixture trace（OTLP/JSON），
- When 将其 POST 到各后端的 OTLP traces 端点，
- Then 每个后端都完成接入：会话可见，且带有 trace 记录的 agent、model、
  消息、tool call 与 usage。

## Compatibility And Constraints

- Public API：两个新 CLI 命令；kernel 导出两个新的纯函数（`toAtif`、
  `toOtlp`）。现有内容不改变形态。
- Persisted data：用户要求的导出文件；不写其他任何东西。
- Configuration：`--out`；`AGENT_TRACE_REDACT=0` 关闭脱敏。
- Operational bounds：导出在加载后的 trace 上运行，内存画像即加载的画像
  （355 MB 会话约 1.7 s 加载）；写入的文件即投影数据的大小。

## Acceptance Evidence

- Scenario IDs and corresponding tests:
  A1、A3 → kernel `export-atif.test.ts`；A2 → CLI fixture 导出测试加上交付
  PR 中记录的 Harbor 校验器运行；A4 → kernel `export-otlp.test.ts`；
  A5 → 交付 PR 中记录的后端接入运行。
- Runtime or package evidence: `scripts/validate-exports.mjs` 导出每个已注册
  agent 的 fixture 会话并用 Harbor 校验器验证 ATIF 输出（Python，本地运行）；
  其输出附在交付 PR 中。
