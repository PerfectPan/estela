> 中文阅读版。以英文原文 docs/reference/mcp-tools.md 为准。

<!-- source-blob: 1fe76ea21b1bb7b1d5de2c5861e16deb046663db -->

# MCP 工具参考

读者对象：针对 `estela mcp` 编写 MCP 客户端的人，或修改工具的人。本页按照 `packages/server/src/agent-tools/` 中的代码定义（`inputs.ts`、`session-list.ts`、`trace-reads.ts`、`event-read.ts`、`bounds.ts`、`register.ts`），列出每个工具的输入 schema 和结果字段。服务器搭建方式见 [MCP 指南](../guide/mcp.zh-CN.md)；semver 覆盖范围见[公共接口](public-interface.zh-CN.md#mcp-工具)。

## 约定

- 每个工具都是只读的。每个输入都是 JSON 对象；传入未知属性会报错。
- 每个结果都是不超过 40,000 个字符的紧凑 JSON 文本。
- 时间均为 ISO 8601 UTC 字符串。路径中的主目录显示为 `~`。
- 缺失的字段表示日志未记录。在 `summary: "pending"` 的会话条目中，缺失的计数表示尚未计算完成。计数从不默认设为 0。
- 会话工具中的 `traceId` 为可选项；省略时指向 `current`，即启动服务器时指定的会话（只有 `estela mcp <session>` 和带会话启动的开发服务器才有该会话）。
- 事件和泳道 id 仅当由 1 到 128 个字母、数字、`_`、`.`、`:`、`-` 组成且脱敏后保持不变时才按原样返回；其他任何 id 返回为 `@e<n>`（事件，按位置）或 `@l<n>`（泳道，按位置），且所有工具也接受该形式作为输入。重复 id 指向带有该 id 的最后一个事件。
- `truncated` 以路径数组（键和索引组成的数组）的形式列出从携带该字段的对象中被截断的字段。

## 输入

| 工具 | 属性 | 类型与范围 | 默认值 |
|---|---|---|---|
| `estela_list_sessions` | `agent` | 字符串，≤ 64 个字符，代理 id | 全部代理 |
| | `project` | 字符串，≤ 500 个字符；项目名称的子串，不区分大小写 | |
| | `cwd` | 字符串，≤ 1000 个字符；绝对路径或以 `~` 开头的路径；匹配该目录及其内部目录 | |
| | `since` | 日期 `YYYY-MM-DD`（00:00 UTC）或带 `Z` 或时区偏移的日期时间；在该时间或之后有活动的会话 | |
| | `until` | 相同格式；在该时间或之前开始的会话（未记录开始时间时按最近活动时间） | |
| | `hasCompaction`、`hasFailedTools` | 布尔值；`true`：至少 1 个；`false`：记录了该计数且为 0 | |
| | `offset` | 整数 0–100000 | 0 |
| | `limit` | 整数 1–50 | 20 |
| `estela_search_sessions` | `query`（必填） | 字符串，1–200 个字符；在标题和用户自身提示词中匹配，不区分大小写 | |
| | `estela_list_sessions` 的所有属性 | | |
| `estela_session_summary` | `traceId` | 字符串，1–200 个字符 | `current` |
| `estela_list_turns` | `traceId`、`offset`、`limit` | `limit` 为整数 1–100 | `limit` 20 |
| `estela_list_requests` | `traceId`、`lane`（字符串 ≤ 200，泳道 id）、`turn`（整数 0–100000，轮次 `index`）、`offset`、`limit` | `limit` 为整数 1–200 | `limit` 50 |
| `estela_get_event` | `traceId`、`eventId`（必填，字符串 1–200）、`maxChars`（整数 256–20000）、`original`（布尔值） | | `maxChars` 2000，`original` false |
| `estela_reconstruct` | `traceId`、`eventId`（必填，字符串 1–200） | | |

`hasCompaction` 和 `hasFailedTools` 从不匹配代理不记录该计数的会话。当匹配的会话尚未完成计数时，工具会先请求计算其计数并最多等待 5 秒；仍未完成计数的会话会被跳过并计入 `unsummarized`。

## 结果

### `estela_list_sessions`、`estela_search_sessions`

`{ sessions, total, offset, nextOffset?, unsummarized?, agents }`

| 字段 | 含义 |
|---|---|
| `sessions` | 本页的会话条目，按最近活动从新到旧排列 |
| `total` | 跨所有分页的匹配会话总数 |
| `nextOffset` | 存在更多匹配会话时出现；将其作为 `offset` 传入 |
| `unsummarized` | 因计数仍在计算而被跳过的会话数（仅限标记过滤条件） |
| `agents` | `[{ id, sessions }]`：服务器读取的每个代理及其会话数 |

单个会话条目：`traceId`、`agent`、`title?`、`project?`、`cwd?`、`startedAt?`、`lastActiveAt`、`sizeBytes`、`firstPrompt?`、`summary`、各项计数 `turns?`、`requests?`、`inputTokens?`、`outputTokens?`、`durationMs?`、`compactions?`、`subagents?`、`failedTools?`、`error?`（`{ reason, file?, line? }`）以及 `truncated?`。`summary` 为 `ready`、`pending`（计数尚未计算完成）或 `failed`（无法读取该会话；见 `error`）。`sizeBytes` 是会话文件的大小；OpenCode 或 ZCode 会话为 0，因为其数据库文件还包含其他会话。

### `estela_session_summary`

`{ traceId, agent, agentVersion?, title?, cwd?, startedAt?, endedAt?, events, skippedRecords, capabilities, numbers, unavailable, lanes, laneCount, truncated? }`

| 字段 | 含义 |
|---|---|
| `events` | 从日志读取的事件数 |
| `skippedRecords` | 未生成事件的日志记录数 |
| `capabilities` | 该代理的日志能够记录的数据类型（见[概念](../guide/concepts.zh-CN.md#能力)） |
| `numbers` | `turns`、`requests`、`inputTokens`、`outputTokens`、`durationMs`、`compactions`、`subagents`、`failedTools` 中已记录的计数 |
| `unavailable` | 上述列表中该会话日志未记录的计数名称 |
| `lanes` | 最多 50 条泳道：`{ id, parentId?, title?, depth, spawnEventId?, requests, failedTools, compactions }`；主泳道 `depth` 为 0，其启动的子代理为 1，每嵌套一层加 1；`spawnEventId` 为启动该子代理的事件 |
| `laneCount` | 会话中的泳道总数 |

### `estela_list_turns`

`{ traceId, total, offset, nextOffset?, turns }`。单个轮次：`index`、`promptEventId?`（首条提示词之前的事件无此字段）、`prompt?`、`start`、`end`、`firstEventId`、`lastEventId`、`events`、`requests`、`inputTokens?`、`outputTokens?`、`durationMs?`、`failedTools`、`failedToolEventIds`（最多 20 个）、`compactionEventIds`（最多 20 个）、`truncated?`。

### `estela_list_requests`

`{ traceId, total, offset, nextOffset?, requests }`。单个请求：`id`（`request` 事件 id；传入 `estela_reconstruct`）、`ts`、`lane`、`turn?`、`model?`、`inputTokens?`、`outputTokens?`、`durationMs?`、`finishReason?`、`granularity?`（当用量覆盖多于一次模型调用时为 `turn` 或 `session`）、`eventIds`（其产生的回复与工具调用，最多 20 个）、`eventCount`、`truncated?`。

### `estela_get_event`

`{ traceId, maxChars, event }`。`maxChars` 为实际使用的长度上限。事件结构：`id`、`seq`、`ts`、`kind`、`lane`、`parentId?`、`requestId?`、`shadowedBy?`（将其移出模型上下文的上下文压缩）、`source`（`{ file, line }`）、`payload`、`original?`（解析后的日志记录，仅当 `original: true`）、`originalUnavailable?`（无法读回原记录的原因）、`truncated?`、`omitted?`（为满足大小上限而省略的 `original` 和/或 `payload`；省略 `payload` 时返回 `{}`）。

### `estela_reconstruct`

`{ traceId, eventId, completeness, unavailable, slots, tokens, visibleIds, visibleCount, removedIds, removedCount, truncated? }`

| 字段 | 含义 |
|---|---|
| `completeness` | `full`，或当存在不可用槽位时为 `partial` |
| `unavailable` | 日志未记录的槽位名称列表 |
| `slots` | 对应 `system`、`tools`、`summary`、`messages`、`currentTurn` 的 `{ name, status, eventIds, eventCount, recordedBy? }`；`status` 为 `present`、`empty` 或 `unavailable`；`recordedBy` 为记录系统提示词或工具的提示词快照 |
| `tokens` | 已记录的计数及其各自覆盖的槽位：`{ slots, tokens, from }`，其中 `from` 为 `request.inputTokens` 或 `compaction.postTokens` |
| `visibleIds`、`visibleCount` | 模型所见的最后一批 id（距该事件最近）及其总数 |
| `removedIds`、`removedCount` | 该事件之前被上下文压缩移除的最后一批 id 及其总数 |

## 大小上限

| 限制项 | 数值 |
|---|---|
| 结果大小 | 40,000 个 JSON 字符 |
| 列表分页 | 最多 `limit` 项；若下一项将超出大小上限则提前结束当前页，并设置 `nextOffset` |
| 列表和摘要中的标题与项目名 | 200 个字符 |
| 提示词、错误原因、路径 | 300 个字符 |
| 列表和摘要中其他已记录的字符串 | 128 个字符 |
| 条目内部的 id 列表 | 20 个 id |
| 摘要中的泳道数 | 50 |
| `estela_get_event` 中的字符串 | `maxChars`；若结果仍过大，`maxChars` 按 0.75 的比例逐级下调至 256，之后依次省略 `original` 和 `payload` |
| `estela_reconstruct` 的 id 列表 | 每个列表保留最后 100 个 id，若结果仍超过上限则继续减半 |

无论 `ESTELA_REDACT` 的取值如何，每个已记录的字符串都会先脱敏再由工具截断，因此工具自身的截断绝不会遗留主目录路径的一部分。会话标题和首条提示词到达工具时已经在脱敏前被截断（标题为 80 个字符，首条提示词为 500 个字符）；脱敏会把这种截断在末尾留下的残缺主目录路径也替换为 `~`，覆盖它识别的所有拼写形式（见[隐私与脱敏](../guide/privacy.zh-CN.md)）。

## 错误

调用失败会返回一条 MCP 错误结果（`isError: true`）。服务器框架 DevFrame 会在 Estela 的消息前加上自己的前缀，因此客户端收到的文本格式为：

```text
Error invoking "estela_list_sessions": Error: estela_list_sessions: limit: expected an integer from 1 to 50
```

Estela 自身的消息部分：

| 原因 | 消息 |
|---|---|
| 无效输入 | `estela_<tool>: <field>: <what it expects>`，或 `estela_<tool>: unknown argument "<key>"` |
| 未知代理 | `unknown agent "<id>"; this server reads <ids>` |
| 未知 trace id | `unknown trace id: <id>; estela_list_sessions lists the trace ids, and "current" exists only when the server was started with a session` |
| 未知事件 | `no event <id> in <traceId>` |
| 未知泳道 | `no lane <id> in <traceId>; estela_session_summary lists the lanes` |
| 无法加载的会话 | 加载错误原文 |

每条消息均经过脱敏。
