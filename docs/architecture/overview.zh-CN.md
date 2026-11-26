> 中文阅读版。以英文原文 docs/architecture/overview.md 为准。

<!-- source-blob: 5831a7f09088641ad524ed8f53bed4ea81011bd0 -->

# 架构

读者对象：修改查看器或会话读取逻辑的开发者。会话读取（发现、检测、解析、摘要）属于 `@rivus/agent-kit` 的职责；`packages/server` 在运行时导入它来读取会话，`apps/cli` 在运行时仅导入其脱敏和 Node 平台入口。内核是唯一另一个在运行时导入该包的模块，仅限于导入无额外依赖的 `/cost` 和 `/cost/prices`（见[费用](#费用)）。其他包可以通过 `import type` 使用其类型，例如来自 `@rivus/agent-kit/transcript` 的 `SessionSummary` 和来自 `@rivus/agent-kit/sessions` 的 `SessionRef`（`{ agent, path, sessionId? }`）。Trace 在各处都将代理命名为 `agent`，与 kit 保持一致：包括 `SessionRef`、规范 `Trace.agent`、传输行以及索引。

## 整体结构

```text
agent roots
  -> kit adapter.discover (head/tail, 64 KB each end)      -> rows
  -> session index (index.sqlite, trace id + size + mtime) -> cached numbers
  -> kit summarize pass, 4 at a time, newest first         -> summary updates
  -> DevFrame list-sessions + shared state `sessions`      -> session browser

agent log
  -> kit session adapter (platform fs, onProgress, AbortSignal)
  -> Trace { schema: estela, events[] with source pointers }
  -> rpc TraceStore (traceId -> session catalog): last 3 traces, originals dropped
  -> kernel toView / fold / reconstruct / projections
  -> DevFrame load-trace (progress stream) + get-trace-view + get-event
  -> Solid workspace: header, SVG timeline, virtualized ledger, inspector

one session (build <path>, or export-report on the dev server)
  -> buildReport: view trace + summary + first events in full, always redacted
  -> DevFrame static build baking report-trace
  -> packForFile: one index.html (report JSON, script, styles, fonts inlined)
  -> the same SPA in report mode, opened from file://

dsh plugin (@rivus/dsh-estela inside dsh web)
  -> conversation.view slot (React, no JSX) -> <estela-workspace> (Shadow DOM, Solid)
  -> /estela RPC channel (session/open, trace/view, trace/event; unary, owner-only)
  -> createEstelaCore -> TraceStore (opaque stamp-keyed traceId) -> kit dsh reader
```

`events[]` 是归档存储。每个事件都可以返回其原始记录：TraceStore 保存每个事件的源指针，`get-event(traceId, id)` 会通过平台再次读取它——对于普通文件是字节范围，对于压缩日志或 SQLite 行则使用 kit 的读取器，将指针解析到解压偏移量或存储的记录。TraceStore 在加载时记录每个源文件的大小与 mtime，以及每条记录的指纹（对于 SQLite 行则是整条存储记录）；如果此后文件发生变化（例如运行中的会话追加写入），当前读回的记录仍必须匹配该指纹，否则事件会返回 `originalUnavailable` 及原因。规范 JSON 文件把原始记录保存在文件内部，因此 `get-event` 对每个缓存条目只需重新加载该文件一次；报告则一次性解压压缩日志以获取其全部事件。

`packages/server/src/sessions/conformance.test.ts` 会针对每个内置适配器在 `fixtures/sessions/<agent>/conformance` 上运行 kit 的 `sessionAdapterConformance`。它保障本查看器依赖的读取规则：每条输入记录都会变成一个或多个事件，或一条带原因的 `skipped` 条目；第二次加载会得到相同顺序的相同事件 id；每个源指针都能读回其原始记录；且当且仅当会话文件记录了相应内容时，trace 才列出 `systemPrompt` 和 `toolSchemas`（其他各项能力则表示该代理会记录此类数据，并不代表每个会话都包含）。

## 事件载荷与解析

`TraceEvent`（`packages/schema/src/types.ts`）即 kit 的 `TranscriptEvent`（以 `kind` 区分的联合类型），并加上视图 trace 在每个载荷上添加的字段：`$truncated`，以及 `system` 上的 `systemPromptSameAs` / `toolsSameAs`。内核和网页应用按 `event.kind` 收窄类型并读取带类型的字段；代理自行添加的字段保留在载荷中，按 `unknown` 读取，并在「输入」标签页中展示。未知数据在入口处解析一次，之后的代码读取带类型的值：

| 输入 | 位置 | 检查 |
|---|---|---|
| 代理记录 | kit 适配器 | kit 的 `zod/mini` schema；`transcriptToTrace` 将 kit 事件原样放入 `Trace` |
| 规范 JSON 文件 | `packages/server` `loadSession` | `isTrace`，逐个按 kind 检查每个载荷；未通过检查的文件像其他文件一样交由 kit 读取 |
| 视图 trace | 内核 `toView` / `fitView` | 对返回的视图执行一次 `assertTrace`（不对 `fitView` 试探的每个上限都执行）；不是 `Trace` 的视图会抛出异常 |
| 报告 JSON | 网页端 `shell/report.ts` | trace schema、kit 的 `SessionSummary` 以及事件详情；遇到首个问题即抛出异常 |
| RPC 输入（浏览器） | 各个 RPC 处理函数 | 一个 `zod/mini` schema，其 `error` 文本即客户端看到的错误消息 |
| MCP 工具输入 | `packages/server` `agent-tools/inputs.ts` | 每个工具一个严格的 `zod/mini` schema，同时作为其对外声明的 JSON Schema；错误文本标明工具名和字段名 |
| 索引行、捕获的错误、`emitWarning` 参数 | `runtime-node` | 每条 SELECT 一套行 schema；针对 `errcode` 和 `EEXIST` 的 `z.object`；Node 的重载类型 |
| DevFrame 转储文件、包清单 | `packages/server`（转储文件）、`apps/cli`（包清单） | `zod/mini` schema |
| dsh 插件通道输入与格式错误 | `apps/dsh-plugin` `src/contract/channel.ts`、`src/host/sessions.ts` | 每个端点对应的 `zod/mini` schema（有界、不含控制字符的 id）及 `SessionFormatUnsupportedError` 校验 |

每种 kind 的载荷 schema 都是在 kit 已声明字段之上的松散对象。`satisfies` 将每个 schema 的输出绑定到 kit 的载荷类型，而 `payloads.test.ts` 检查该类型的每个载荷都能通过校验，从而使已声明字段无法偏离 kit 类型，且 kit 新增必填字段时会导致类型检查失败。kit 新增的可选字段会同时通过这两项检查：松散对象会保留它，但在 schema 声明它之前不做校验。这些 schema 不含默认值或转换逻辑，调用方通过类型守卫而非解析输出保留已校验的值，因此对象引用和键顺序都按原样保留，规范夹具加载后与其原文件一致。实时 RPC 结果不会在浏览器中再次解析：两端打包在同一个 tarball 中，且服务器已在上表任一边界检查过该值。处理函数自行解析输入，而不使用 DevFrame 的 `args` 选项，因为该选项会在 MCP 接口上声明位置参数 `arg0`（[devframe#420](https://github.com/devframes/devframe/issues/420)）。MCP 工具（见下文）通过 `ctx.agent.registerTool` 注册，其 `inputSchema` 由解析调用的同一严格 `zod/mini` schema 生成，因此声明的 schema 与实际校验不可能发生漂移。

索引只是缓存：头部解析失败的已存储行会连同其提示词和搜索行一起被删除，下一次发现扫描会重新写入它；解析失败的摘要不予提供；损坏的 `context_shape` 只丢失形状图本身。对任意 JSON 进行遍历时，若为每个值编写 schema 成本过高（如源记录指纹、视图的字符串长度上限），则使用 es-toolkit 的 `isPlainObject` 和 `isPrimitive`。

## 会话索引与会话目录

`packages/server/src/catalog/session-catalog.ts` 是会话目录。它为每个内置 kit 适配器调用 `roots(home)` 和 `discover`，对每个文件执行 stat 以获取缓存键，并通过 `list-sessions` 提供列表行。不存在的根目录会生成一条 `count: 0` 并附带已检查路径的代理条目。`discover` 或 `summarize` 无法读取的文件会成为带有 `error`（原因、文件、行号）的行。`stat` 失败的根目录（进程无法访问的代理目录）会成为该根目录的一条这样的行，kit 报告无法列出的根目录也是如此；其他根目录和代理仍会列出，入口层会在终端说明该根目录。有两类读取器是第二种情况的例外。OpenCode、ZCode 和 DimCode 进不去某个目录时，把失败报在该目录的数据库文件上而不是目录上，所以有这一行、没有终端提示；进得去但列不了的目录对它们没有影响，因为它们直接读那个文件。Kimi Code 和 Antigravity CLI 把读不了的目录当作空目录，所以两者都没有。让整轮扫描失败的错误，要等每个代理的扫描都结束后才抛出，因此此时读不了的根目录都已记录。Claude Code 的子代理文件由 kit 适配器折入其父会话。

摘要按最近活动从新到旧每次并发 4 个运行；`list-sessions({ first })` 会将屏幕上的行移到队列前端，64 MB 及以上的文件单独运行。每次摘要都调用 kit 的 `summarizeSession`：如果适配器有有界遍历就使用它（在不持有转录的前提下统计数字和主代理上的用户提示词供搜索），否则执行折叠加载。提示词仅包含用户自身输入：kit 的规则会跳过压缩摘要、元说明、斜杠命令包装、中断以及代理注入的文本。完成的摘要每批次在单个事务中写入，并通过 DevFrame 共享状态 `estela:sessions`（`{ revision, pending }`）广播；浏览器随后请求 `list-sessions({ since })` 获取发生变更的行。搜索通过 `list-sessions({ query })` 发起并在索引中运行；当指定 `--no-index`、索引不可用或索引繁忙时，在内存中对标题和首条提示词运行相同的子串匹配规则。

`packages/runtime-node/src/session-index.ts` 通过 `node:sqlite` 管理 `index.sqlite`（位于 `$XDG_CACHE_HOME/rivus-estela/`，否则为 `~/.cache/rivus-estela/`，权限模式 0600）：包含 `sessions`（头部字段、摘要数字、缓存键）、`prompts`（前 200 条提示词，每条 500 个字符）以及 `search`（每个会话一行的 FTS5 `trigram` 表）。3 个及以上字符的查询使用 FTS5；更短的查询在标题和提示词上执行子串匹配，两侧应用统一的 JavaScript 大小写折叠（注册的 `casefold()` 函数），因此 `Über` 和 `Добро` 在任意大小写下都能匹配。每个摘要行存储壳层的 `INDEX_SUMMARY_VERSION = SESSION_SUMMARY_VERSION + HOST_ERA_OFFSET + INDEX_CONTENT_REVISION`；来自其他版本的行会重新计算。各组成部分定义在 [`packages/server/src/catalog/session-catalog.ts`](../../packages/server/src/catalog/session-catalog.ts)。索引以 WAL 模式运行并设置 200 ms 的 busy timeout（node:sqlite 是同步的，更长的等待会阻塞服务器）：读操作从不等待其他进程，而无法获取锁的写操作会被跳过。Schema 在 `BEGIN IMMEDIATE` 内创建，因此多个进程可以同时打开全新缓存；损坏或其他布局的文件只由持有 `index.sqlite.lock` 的进程重建；无法打开的索引（例如只读缓存目录）会打印一条警告并跳过。`PRAGMA user_version` 记录表结构版本；版本不同或无法读取的文件会被删除并重建。第二次启动时列表行直接立即从索引返回，`discover` 扫描则在后台对账。`--no-index` 不打开任何索引文件。由于首屏只需要 `discover` 和索引读取，即使面对数千个会话和数 GB 日志，设计目标也是在 2 秒内显示行。`node scripts/check-budgets.mjs` 在 5,000 个合成会话（Claude Code 和 Codex，约 190 MB）上测量从进程启动到返回包含所有行的首个 `list-sessions` 响应的时间：在设定预算时，一台 Apple-silicon 笔记本上冷启动为 1.0 到 1.8 秒，热启动为 0.2 到 0.4 秒。CI 设有宽松上限以在较慢 runner 上捕获数量级退化，并在热启动未从索引提供行时判为失败；预算数值及其原因见 `scripts/budgets/budgets.mjs`。

会话通过其 trace id（`traceId`）寻址，它是代理和路径的哈希。OpenCode 列表行始终包含会话 id，即使数据库中只有一个会话也是如此；打开方式为 `estela <path>#<sessionId>`。其他代理仅当多个会话共享同一个文件时包含会话 id（`path#id` 形式），因此使用 `estela <path>` 打开单会话文件时会保留其列表行的 trace id。命令行上的 `path` 或 `path#id` 字符串会在入口解析一次为 kit 的 `SessionTarget`（`parseSessionTarget`）；已发现的会话则是 kit 的 `SessionRef`。列表和 `--pick` 标签中的标题、项目和提示词像工作区一样经过脱敏（主目录和令牌模式），是否脱敏由服务器的 `redacts` 选项决定（见[服务器组装](#服务器组装)）；只有设置了 `ESTELA_REDACT=0` 时开发服务器才传入 `false`。会话目录维护 trace id → 目标的映射并作为 TraceStore 的解析器：每个列表行都可以解析，从命令行（通过路径或 `--pick`）打开的会话同样如此，并会成为 `current`。URL 只携带 trace id（`#/s/<traceId>`）。CLI 打开时使用 `?s=<traceId>`，因为 DevFrame 的一次性验证码占用了 URL fragment；SPA 会在首次连接尝试结束时（无论成功与否）把 id 移回 `#/s/<traceId>`。

## 视图 trace、加载与重建

`get-trace-view(traceId)` 返回 `toView(trace)`：不含 `original`，每个字符串和键均截短至最多 4,096 个 UTF-16 码元（绝不切分代理对），被截短的路径以键和索引数组的形式记在 `payload.$truncated` 中，源文件驻留去重在 `sourceFiles` 中，`skipped` 按文件和原因合并。仅当视图会超过 12 MB 预算时，`fitView` 才以 0.75 为步长逐步降低上限；视图会在 `view.maxString` 记录实际使用的上限，且当即使降到 256 下限仍超出预算时记录 `view.withinBudget: false`（同时在服务器端记录一次日志）。当上限低于 4,096 或视图超出预算时，工作区会显示提示。视图只保留每个不同的提示词快照系统提示词和非空工具列表各一份，存放在第一个拥有它的快照上；之后内容相同的快照在 `systemPromptSameAs` / `toolsSameAs` 中指名该快照，并将字段列在 `payload.$truncated` 中，以便 `get-event` 仍能返回完整内容且 `reconstruct` 在视图上给出相同结果。Codex 事件 id 采用 `L<line>`（每个 trace 一个文件）以降低每个事件的开销。

加载流程：浏览器调用 `load-trace(traceId)`，使用返回的 id 订阅 `load-progress` 流（已读取字节数占文件大小的比例），然后调用 `get-trace-view(traceId)`。需要两次调用是因为 DevFrame 会拒绝订阅尚未存在的流 id（`DF0030`）。同一会话的加载会共享。取消流、断开连接、5 秒内未订阅，或同一连接发起更新的 `load-trace` 都会释放持有引用；最后一个引用释放时会中止加载。该连接的 `get-trace-view` 复用其持有引用；其他任何读取方（另一个标签页、MCP 工具）各自持有引用，因此一个浏览器的导航绝不会取消另一方的读取。持有引用不触及已加载的 trace，因此被逐出的 trace 可以被垃圾回收。当解析器附加了预期文件印记（`ResolvedSession.expect`，由 dsh 插件使用）时，`TraceStore` 会在读取之后、写入缓存之前重新核对 `target.path`，不匹配时直接抛出 `SnapshotChangedError` 且不缓存。错误消息离开 TraceStore 时已经脱敏。`traceId` 是不透明的，由壳层解析：在开发服务器上通过会话目录解析（TraceStore 的缓存键为 trace id，因此 `current` 与启动会话的列表行共享同一缓存条目）；在 `mcp <path>` 和 `build` 下只解析 `current`，以启动会话的 `path#id` 字符串为键；不带路径的 `mcp` 像开发服务器一样运行会话目录。工作区路由会展示该加载进度（已读取字节数占文件大小的比例），调用 `get-trace-view(traceId)`，并为「原始记录」标签页以及被截短事件的完整文本调用 `get-event(traceId, id)`。按 DevFrame 的设计，已关闭的客户端视为终态且从不重连，因此当套接字断开时，工作区和会话浏览器会提示「与 Estela 服务的连接已断开。」并提供「重新加载」；在该提示下，已加载的工作区仍可继续阅读。

开启脱敏时，脱敏会改写的事件或泳道 id（例如指向主目录的 id）以别名形式离开 store：该位置上的事件为 `@e<seq>`，泳道为 `@l<n>`，在 `id` 以及引用它的每个字段（`agentId`、`parentId`、`shadowedBy`、`agents[]`、`summaryEventId`、`systemPromptSameAs`、`toolsSameAs`）中都是如此。id 仅当由 1–128 个 `[A-Za-z0-9_.:-]` 字符组成且脱敏后保持不变时才按原样显示；其他都是别名。别名总能指到它的记录：`get-event` 和 `reconstruct` 接受别名作为输入，`estela_get_event` 也一样，它把 id 交给 store，事件的 id 按 store 显示的形式原样使用，用的是工具自己的脱敏规则。指向不存在事件的引用保留原文交给文本脱敏，除非它本身形似别名：这时显示为 `@e?`，以免指到 trace 中的某个事件。store 显示出来的形式的 id（别名、`@e?`、`@l?`）只按这种形式解析，即使某个记录 id 的字面就是它：`get-event` 回答没有这个事件，`reconstruct` 按事件缺失作答。`requestId` 把同一次模型请求的事件归为一组，和其他字符串一样脱敏。

投影全部为基于 `Trace` 的纯函数：`projectRequests`（每个请求一条，仅包含已记录的数字）、`projectLanes`（主泳道加上每个子代理一条泳道，含请求以及提示词、失败工具和上下文压缩标记）、`projectTurns`（轮次从主泳道提示词开始；钩子运行折叠为一行；按轮次汇总），以及 `hiddenAfterCompaction`（源自 `shadowedBy`）。`fold` 只对代理声明的能力累加会话摘要数字。

`reconstruct(trace, eventId)` 在该事件所属的泳道上运行（没有提示词记录的子代理泳道从泳道起点开始其轮次；其系统提示词仅在该泳道记录了它时才计入）。它返回可见 id、被上下文压缩移除的事件、状态为 `present` / `empty` / `unavailable` 的五个槽位（系统提示词、工具、摘要、消息、本轮）——当 trace 包含提示词快照（`type: 'prompt_snapshot'` 的 `system` 事件）时，系统提示词和工具取自该泳道在该事件或之前最新的快照（`slot.recordedBy`）——以及 `tokens[]`，即代理记录的计数及其覆盖的槽位：请求的输入 Token，以及紧随其后的首个请求上的上下文压缩 `postTokens`。它从不估算槽位，也不编造消息。

`diffContext(trace, firstId, secondId)`（`packages/kernel/src/context-diff.ts`）比较同一泳道上两次 `reconstruct` 的结果，从较早事件比较到较晚事件：按槽位列出新增、移除和未变的事件 id（任一侧为 `unavailable` 的槽位不进行比较）、进入和离开上下文的事件、`compacted`（较晚结果的 `removedIds` 减去较早结果中的对应集合：恰好是两者之间由上下文压缩通过 `shadowedBy` 隐藏的事件）、两者之间该泳道上的上下文压缩、按内容比较的系统提示词和工具列表（在视图中遵循 `systemPromptSameAs` / `toolsSameAs`；在视图中被截断的值绝不会仅凭文本判为相等；工具名称来自 `{ name }` 或 `{ function: { name } }` 定义，否则报告为未记录），以及当双方均已记录时输入 Token 的差值。位于不同泳道的一对事件会被拒绝（`different-lanes`）：每条泳道都是独立的对话。代理每次请求只记录一个输入 Token 总数，并在上下文压缩时记录压缩前后的总数，但不按槽位拆分，因此上下文差异与工作区都不显示按槽位划分的 Token：否则只能从文本长度估算。时间线柱条高度显示已记录的总数随时间的变化，而差异视图按槽位统计事件数量，并标注为事件数（见[对比](../guide/workspace.zh-CN.md#对比)）。

`reconstruct` RPC 接收 `{ traceId?, eventId }`；未提供 trace id 时读取启动会话 `current`。其结果像 `get-event` 一样经过呈现处理（脱敏），`eventId` 是视图显示的 id：记录中的 id 或别名。它不是代理工具：`estela_reconstruct` 是下文所述的 MCP 工具之一。

## 包结构

| 包 | 职责 |
|---|---|
| `packages/schema`（`@rivus/estela-schema`） | 规范 `Trace`（`schema: 'estela'`）、事件类型、能力、`shadowedBy`、基于 kit 构建的事件载荷类型，以及校验 JSON trace 的 `zod/mini` schema |
| `packages/kernel`（`@rivus/estela-kernel`） | 规范文件头部检查、`SessionFs` 读取接口形状、折叠、重建、`diffContext`、`toView` / `fitView`、投影、目录价费用 |
| `packages/runtime-node`（`@rivus/estela-runtime-node`） | 主目录、会话索引（`node:sqlite`） |
| `packages/rpc`（`@rivus/estela-rpc`） | 基于注入会话服务的 `list-sessions`；基于 `TraceStore` 与注入解析器的 `load-trace`、`get-trace-view`、`get-event`、`reconstruct`；基于注入写入器的 `export-report`；`buildReport`；仅在 DevFrame 构建模式下注册的 `report-trace` |
| `packages/server`（`@rivus/estela-server`） | `createEstelaCore`（`./core`）：不含 DevFrame 与会话目录的加固平台、基于 Node 读取的 TraceStore 和脱敏；`createEstelaServer`：在其上加入会话目录、按实例构建的 RPC 定义、报告写入器、MCP 代理工具（`src/agent-tools/`）以及由 `setup` 负责注册和启动的 DevFrame 定义；通过 kit 读取会话 |
| `apps/web`（`@rivus/estela-web`） | Solid SPA：哈希路由 `#/`（会话浏览器）和 `#/s/<traceId>`（工作区）、报告模式、`<estela-workspace>` 自定义元素（`./embed`）、设计 token、`en` / `zh-CN` 词典 |
| `apps/cli`（`@rivus/estela`） | 命令行、终端输出、打开浏览器，以及 ATIF 和 OTLP 导出；基于 `createEstelaServer` 启动 `dev`、`build` 和 `mcp`；以 `@rivus/estela` 发布 |
| `apps/dsh-plugin`（`@rivus/dsh-estela`） | DeepSeek Harness 插件：基于 `createEstelaCore` 的宿主端（`src/host/`）、基于 `<estela-workspace>` 的客户端（`src/client/`）、通道契约（`src/contract/`）、清单与 `cordis.patch.yml`，以及两份产物（`dist/host.mjs`、`dist/client.js`）；以 `@rivus/dsh-estela` 发布 |
| `apps/e2e`（`@rivus/estela-e2e`） | 私有包：针对已安装 tarball 的 CLI 冒烟测试和 Playwright 测试套件 |

## 服务器组装

`createEstelaCore(options)`（`packages/server/src/core/estela-core.ts`，以 `@rivus/estela-server/core` 导出）构建不含 DevFrame 与会话目录的单实例核心：加固平台、TraceStore（从 `@rivus/estela-rpc/trace-store` 读取）、`seed` 和跟随 `redacts` 的文本脱敏器；该入口还导出 `traceIdOf`，供自行生成键的宿主使用。`createEstelaServer(options)`（`packages/server/src/composition/estela-server.ts`）在 `createEstelaCore` 之上加入会话目录、按实例隔离的 RPC 函数定义、会话发布器和报告队列，并返回负责注册和启动它们的 DevFrame 定义。选项包括包身份信息及已构建的 SPA（`app`）、平台实现（读取、主目录、环境变量；默认为 Node 平台）、目录配置（开发服务器和不带路径的 `mcp` 使用 `{ index }`，`mcp <path>` 和 `build` 不使用）、启动会话目标、脱敏开关（`redacts`）、报告目录（`reportDir`，可选），以及接收 TraceStore 警告的日志行输出函数。在 `dev` 模式下，该定义的 `setup` 会加载启动会话并将其设为 `current`、启动会话目录、恢复会话目录的摘要任务、在 `ctx.agent` 上注册 MCP 代理工具，并将该实例的会话发布器绑定到共享状态；在 `build` 模式（报告）下则只注册函数。每个步骤只执行一次：CLI 会在服务器监听前执行启动会话加载、会话目录启动以及 `--pick` 的 `open`，以显示旋转指示器、索引进度和选择器，随后 `setup` 会发现它们已完成。只运行 `setup` 的 DevFrame 宿主也能得到相同的服务器。每个服务器各自闭包持有自己的服务、发布器和报告队列，因此一个进程可以并存多个实例。`apps/cli/src/server.ts` 从已发布的包中填入 `app`（其名称、版本和 `dist/web/`）；`dev`、`build` 和 `mcp` 均从此处启动。工厂及其子模块各自抛出自己的错误；`apps/cli/src/entry/failure.ts` 负责映射它们。

`redacts` 是会话文本的唯一开关：它决定 trace RPC 返回的内容，以及列表行和 `--pick` 标签中的标题、项目和提示词是否脱敏。服务器代码不读取 `ESTELA_REDACT`；每个入口自行算出这个值（`apps/cli/src/entry/app.ts`）：只有设置了 `ESTELA_REDACT=0` 时开发服务器才传入 `false`，`mcp` 和 `build` 始终传入 `true`。无论这个开关取值如何，报告、MCP 工具结果和错误、列表行的工作目录和读取错误、检查过的根目录，以及索引自身的失败原因始终保持脱敏（见[信任](#信任)）。

`close()` 先停止会话目录，再关闭索引：等待中的摘要不再运行，仍在运行的摘要结束时结果直接丢弃（不写索引、不挂 flush 定时器、不推送会话状态），等待摘要的 `whenIdle()` 调用方立即返回；等待 `discover` 扫描的调用方要等扫描结束才返回，`close()` 不会中止扫描。在服务器停止后调用它。

## MCP 代理工具

`packages/server/src/agent-tools/` 包含 [MCP 工具参考](../reference/mcp-tools.zh-CN.md)中列出输入、结果、大小上限和错误的各个工具：`estela_list_sessions`、`estela_search_sessions`、`estela_session_summary`、`estela_list_turns`、`estela_list_requests`、`estela_get_event` 和 `estela_reconstruct`。`registerAgentTools` 在定义的 `setup` 中将它们以 `estela:<name>` 的 id 注册到 DevFrame 的 agent host（列表和搜索工具仅在存在会话目录时注册）；DevFrame 的 MCP 适配器会以 `estela_<name>` 的名称通过 stdio（`estela mcp`）以及仅在启用 `--mcp` 时通过开发服务器的 HTTP `/__estela/__mcp` 提供服务。该路由以 bearer 令牌（DevFrame 的 `authorization` 选项：`ESTELA_MCP_TOKEN`，或由 CLI 每次启动生成并打印）代替一次性验证码，因为 MCP 客户端无法回答验证码。DevFrame 自带的 `Origin` 检查是关闭的，因为它会拒绝不带 `Origin` 的请求，而命令行客户端不发送 `Origin`；CLI 的 `authorization` 回调（`apps/cli/src/entry/mcp-authorization.ts`）会拒绝非回环地址的 `Host`（DNS rebinding）或 `Origin`（网页发出的每个 POST；不带 `Origin` 的跨源请求无法携带 `Authorization`），然后比对令牌。DevFrame 只在路由没有令牌时检查对端地址，因此 CLI 改为在 `--host` 不是回环地址时拒绝 `--mcp`；该路由默认关闭。`estela mcp` 和该 HTTP 路由都会关闭 DevFrame 的共享状态工具。

这些工具读取浏览器所读取的同一套数据：会话目录行（使用始终脱敏规则调用 `listSessions`，并传入 `first` 以便摘要标记过滤尚不能检查的行，最多等待 5 秒），以及 TraceStore 中已加载的 trace（通过 `TraceStore.withTrace` 获取自身持有引用），再经过内核投影、`get-event` 和 `reconstruct` 处理。它们不做任何估算。在工具边界、底层服务之后，无论 `ESTELA_REDACT` 的取值如何，每条结果和错误消息都会使用 kit 的 `redact` 和平台主目录进行脱敏，并序列化为紧凑 JSON 文本返回（DevFrame 若收到对象会进行格式化缩进）。每次结果最多 40,000 个字符：列表通过 `offset` / `limit` 分页，并在超限前通过 `nextOffset` 提前结束；已记录的字符串先脱敏再截断（若先截断可能将主目录开头留在文本中），目录也在截短提示词前先脱敏；kit 自身会在任何脱敏前先截断标题和首条提示词，其 `redactText` 会把这种截断在末尾留下的残缺主目录路径替换为 `~`；被截断的列表字符串会记在 `truncated` 中；`estela_get_event` 在脱敏后用内核的 `capStrings` 截断字符串，并按 0.75 步长下调上限至 256，之后依次省略 `original` 和 `payload`；`estela_reconstruct` 对每个列表保留最后 100 个 id 并附带总数。

事件和泳道 id 由写入日志的一方生成，并会作为工具输入传回。`estela_get_event` 把 id 交给 store，由 store 解析一次并用工具的脱敏规则显示事件的 id，因此本身形似别名的记录 id 仍指向它自己的事件。`TraceIds`（`packages/rpc/src/trace-ids.ts`）是上文 trace RPC 和其他工具共用的规则：仅当 id 为 1–128 个 `[A-Za-z0-9_.:-]` 字符且脱敏后保持不变时才按原样返回；其他任何 id 都返回为 `@e<seq>`（事件索引）或 `@l<n>`（泳道位置），工具同时接受这两种形式。重复 id 指向其中的最后一个事件，与 TraceStore 的查找行为一致。工具描述中写明返回结果是已记录的会话内容，应视为数据而非指令。代理技能位于 `skills/estela/SKILL.md`，保留在仓库中且不打入 tarball。

## 工作区

`#/s/<traceId>` 从上到下绘制：会话页头（来自 `get-trace-view` 的 `summary`，即对 trace 执行 `fold`；未声明的能力显示「—」）连同来自 `priceTrace` 的目录价费用、SVG 时间线、事件列表以及检查器。页面上的全部内容均在浏览器中使用内核根据视图 trace 计算得到：

- 时间线（`apps/web/src/workspace/timeline/`）：`projectLanes` 提供泳道、请求和标记。柱条高度代表请求记录的输入 Token；没有用量的请求为空心柱条。间距小于 3.5 px 的请求合并为一根柱条（取最大值），从而让包含 10,000 个事件的会话也能保持很小的 SVG。上下文压缩是一条虚线，有记录时带 `pre → post` 方框标签；距离过近无法画框的标线将标签放入悬停提示。拖动可选择范围；两个手柄为 `role="slider"`，可通过方向键（1 %，配合 Shift 为 10 %）、Home 和 End 移动。范围刷选数学逻辑在 `lib/timeline-scale.ts` 中。
- 事件列表（`workspace/ledger/`）：`lib/ledger-model.ts` 基于 `projectTurns` 构建轮次，用 `foldHookRuns` 折叠钩子运行，将工具结果与其调用配对，并将某个轮次内各子代理泳道的事件收进其启动调用处的单行里。`flattenLedger` 应用折叠、展开、类型筛选标签和范围刷选。「代理」布局的 `flattenLanes`（`lib/ledger-lanes.ts`）则将相同条目置于每条 `projectLanes` 泳道的一个标题下；条目在两种布局中保留相同的键，切换布局时会将选中行映射到对应条目（子代理行与其启动调用互为映射）。`@tanstack/solid-virtual` 按行类型使用固定高度绘制（普通行 36 px、轮次和泳道标题 40 px、钩子折叠行 30 px、上下文压缩 44 px），因此在任意滚动位置 DOM 中都只保留约 40 行。淡化开关使用 `hiddenAfterCompaction`。
- 检查器（`workspace/inspector/`）：「输入」和「输出」展示归一化后的字段；已截短的事件（`payload.$truncated`）在选中时通过 `get-event` 加载完整文本。「模型所见」是在视图 trace 上调用内核 `reconstruct`：含状态信息的槽位、已记录的 Token 数及其覆盖的槽位，以及被移除的事件。「对比」是内核 `diffContext` 对选中请求与其同泳道另一请求的对比结果（`lib/context-compare.ts` 默认选择上一个请求，若之前存在上下文压缩则提供「最近一次压缩之前」，也接受在时间线上按住 Shift 点击柱条，时间线随后会用虚线框标出该柱条）；槽位变化以事件数表示，Token 数字为已记录的输入 Token 以及每次上下文压缩的 pre → post。检查器标签页和对比对象保存在工作区状态中，因此时间线可以切换到该标签页。「原始记录」展示 `get-event` 返回的原始记录。

加载失败时会显示原因、错误中标明的代理、文件和行号，以及重试按钮和返回会话浏览器的链接。时间线和会话浏览器的上下文变化图均由内核投影直接绘制为 SVG，未使用第三方图表库。

主题跟随 `prefers-color-scheme`，直到用户手动选择深色或浅色，并将选择保存在 `localStorage`（`apps/web/src/shell/theme.ts`）。界面支持英文和简体中文（`apps/web/src/i18n/locale.ts`）：当浏览器首个首选语言以 `zh` 开头时使用 `zh-CN`，否则使用 `en`；手动切换结果保存在 `localStorage`，`<html lang>` 随当前语言更新。日期、时间、时长和数字均通过 `apps/web/src/lib/format.ts`（使用对应语言的 `Intl`）格式化；Token 数在两种语言中均保留 `k` 和 `M` 缩写。会话内容按日志记录原样展示，从不翻译。

## 费用

`priceTrace(trace, pricing)`（`packages/kernel/src/price-trace.ts`）使用 kit 的 `priceRecord` 对每个 `request` 事件计价，返回各请求费用、trace 总计以及每条泳道的合计；`costOfEvents` 累加一个轮次的费用。`snapshotPricing()`（`snapshot-pricing.ts`）将 kit 的 LiteLLM 快照（`litellmPrices`、`litellmPricesVersion`）包装为按需构建的查找表，从而让从不计价的打包产物可以丢弃价格表。内核之所以在运行时导入这两个 kit 入口，是因为它们没有任何依赖；网页应用通过内核获取它们（这会在网页打包产物中增加约 55 KB、gzip 后约 8 KB 的体积），使 `file://` 报告能够在没有服务器的情况下以完全相同的方式为同一个视图 trace 计价。

只有当请求的每一部分（当代理按模型拆分汇总用量时，每个模型对应一部分）都记录了输入和输出 Token、注明了模型且该模型有价格时，该请求才计价；否则它为未计价，并记录首个适用的原因（`no-usage`、`incomplete-usage`、`no-model`、`no-price` 及对应模型）。记录了 0 输入和 0 输出 Token 的请求无论模型为何均计为 $0。缺失 `granularity` 时按单个请求计算，与适配器写入的方式一致，因此长上下文档位按每次请求生效。`CostTotal` 保存已计价合计（没有任何请求计价时 `usd` 缺失，从不为 0）、按原因分类的未计价计数、当所有已计价请求均具备分项时的各类 Token 占比，以及缓存命中率（在同时记录了两者的请求中，缓存读取占输入 Token 的比例）。各分项金额来自 kit 自身的计价逻辑：在部分输入固定后（从而与整部分使用相同的价格档位），费用对各类 Token 呈线性关系，三次探测即可得出输入、缓存读取和缓存写入费率；各分项之和等于 kit 返回的总价。

工作区在页头（标签：命中率，或「M 个请求中有 N 个未计价」，全部未计价时显示原因；悬停提示标明快照和分项）、轮次标题、代理布局的泳道标题以及检查器中展示费用。金额通过 `formatUsd` 格式化（低于一美分保留两位有效数字，再小显示 `<$0.0001`）。费用是已记录 Token 的目录价，不是实际账单。请求的 `pricingMultiplier`（Codex 优先服务等级为 2，kit 从 rollout 的线程设置中读取）会乘到费用上，因为该等级的目录价就是这个倍数。代理自身记录的金额（OpenCode、Pi、Grok、ZCode）不会应用：只有 kit 的用量解码器报告它。DimCode 的请求事件带有它自己记录的金额（`costUsd`），但内核不读取该字段，因此 DimCode 的计价方式相同。请求只按其计费字段（`model`、`usage`、`granularity`、`modelCalls`、`usageByModel`、`pricingMultiplier`）计价，因此会话浏览器用 kit 有界摘要遍历返回的字段（`requestUsage`，与加载后转录中的请求事件相同）按同一规则（`priceRequestUsage`）为会话计价，其总额与页头一致。`index.sqlite` 保存该费用及所用快照版本；以其他快照计价的摘要会重新计算。

`toAtif(trace, { pricing })` 在每个请求已计价的步骤上写入 `metrics.cost_usd`，仅当该轨迹所在泳道的全部请求都已计价时才写入 `final_metrics.total_cost_usd`（对于根轨迹：按 ATIF 定义涵盖整个会话，包含子代理；被上下文压缩隐藏的请求虽不生成步骤但也计入），并在根轨迹上写入 `extra.estela.pricing = { version, unpricedRequests }`；`export-atif` 会传入 `snapshotPricing()`。OTLP 导出在固定版本的语义约定中没有费用属性可填，因此保持不变。

## 报告

报告是将单个会话的工作区打包成的静态页面，无需服务器即可从 `file://` 打开。`build <path> --out-dir <dir>` 和工作区的「导出报告」（`export-report(traceId, locale)`）执行 `packages/server/src/report/report.ts` 中的同一条管线：

1. `buildReport`（`packages/rpc/src/report.ts`）取一份已加载的 trace，用它构建自己的视图和摘要，并按顺序读取前若干个完整事件（载荷与原始记录），直到达到 2,000 个事件或 20 MB 序列化事件体积（取先到者）。无论 `ESTELA_REDACT` 的取值如何，所有内容均使用主目录通过 `redact` 处理；脱敏会改写的 id 由报告给出自己的别名，不管服务器是否对视图脱敏，因此脱敏后文字相同的两个 id 仍指向不同的事件；每个事件都按记录中的 id 去取。视图和这些事件来自同一份已加载的 trace，不管此期间还加载了什么；id 在任何内容被截短之前就得到别名，因此被视图截短的引用仍能指到它的事件。`build` 从已加载的 trace 直接取完整事件（文件只读一次）；而「导出报告」通过 `TraceStore.withEvents` 读取，对源指针分批少量读取，或为整份报告重新加载一次规范文件。
2. DevFrame 的 `createBuild` 在构建模式下运行定义的 `setup`，后者注册一个无参数的额外快照查询 `report-trace` 并绑定到该载荷，然后将其烘焙进 `__rpc-dump/`。构建模式跳过会话推送，因此开发服务器内触发导出不会干扰在线服务器的共享状态。导出一次只运行一个；每次导出都在写入前在服务器的报告目录下创建独立的新目录 `estela-report-<traceId>-<time>`（`reportDir`；服务器未指定时为工作目录），其错误消息在返回浏览器前会经过脱敏。目录名通过普通的 `mkdir` 占用，因此名称已被占用时改用 `-2`、`-3`……，不会写入任何已存在的目录；这也是导出不需要[信任](#信任)一节中 `build --out-dir` 那些规则的原因。
3. `packForFile`（`packages/server/src/report/report-site.ts`）使构建产物可以从磁盘直接打开。Chromium 禁止在 `file://` 下使用 `fetch()`、module script 和外部字体，因此烘焙后的 `report-trace` 输出会作为 `<script type="application/json" id="report-trace">` 移入 `index.html`，module script（网页构建产物为单 chunk；出现其他任何脚本都会使构建失败）和样式表均被内联（`woff2` 字体转为 data URI），并删除 `assets/`、`__rpc-dump/` 和 `__connection.json`。最终产物是单个 `index.html`。

SPA 在检测到该元素时即以报告模式启动（`apps/web/src/shell/report.ts`）：不建立 DevFrame 连接、不显示会话浏览器、不显示导出按钮。工作区从报告中读取视图 trace；`get-event` 变为对内置事件的查找，其他事件则显示视图内容，并在「原始记录」中提示「此报告未包含该事件的原始记录。」。「模型所见」和「对比」像在开发服务器上一样在浏览器中运行 `reconstruct` 和 `diffContext`。一条横幅会提示会话文本和文件内容仍然保留，并在报告未包含全部事件时说明包含了多少条原始记录。报告以导出时记录的界面语言打开（`build` 不记录语言，由浏览器语言决定），并保留语言和主题切换开关。

## 导出

`export-atif <path> [--out <file>]` 和 `export-otlp <path> [--out <file>]`（`apps/cli/src/export/write-export.ts`）加载会话一次并写出一个文件：ATIF v1.8 轨迹（`toAtif`，`packages/kernel/src/export-atif.ts`）或 OTLP/JSON `ExportTraceServiceRequest`（`toOtlp`，`packages/kernel/src/export-otlp.ts`）。两个投影均为基于已校验 `Trace` 的纯函数，不导入任何 `node:*` 模块；CLI 负责脱敏和写出文件。两种映射均在[导出格式](../reference/export-formats.zh-CN.md)中逐字段列出。ATIF：每个 user 事件、每个 `requestId` 分组和每次上下文压缩对应一个步骤（上下文压缩为带有 `extra.context_management` 的 system 步骤），子代理泳道作为内嵌 `subagent_trajectories` 由启动步骤引用，ATIF 未定义的字段连同规范事件 id 放在 `extra.estela` 下。OTLP 固定为 `OTLP_SEMCONV_VERSION` 指定的语义约定版本（`gen-ai-dev/1.42.0-dev`；GenAI 语义约定尚未发布正式版，因此更新版本号属于有意变更）：每条泳道一个 `invoke_agent` span、每次请求一个 `chat` span（含 `gen_ai.usage.*` 计数，以及来自 `reconstruct` 的模型可见表面作为 `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.system_instructions` / `gen_ai.tool.definitions`）、每次工具调用一个 `execute_tool` span。对于没有任何内容可构成步骤的 trace（没有用户、代理或系统提示词内容），ATIF 导出会以该原因失败；ATIF 导出还会省略没有任何可导出事件的子代理泳道，其启动引用也一并省略。除非设置 `ESTELA_REDACT=0`，导出文件会像服务器一样脱敏：数据集或追踪后端可能需要未脱敏的原始字节，因此与报告不同，导出允许选择关闭脱敏。`node scripts/validate-exports.mjs` 会导出所有代理的夹具并运行 Harbor 的校验器（`uv run --python 3.12 --with harbor`）；它依赖 uv 且需要联网，因此 CI 仅运行 `apps/cli/src/export/write-export.test.ts` 中的结构化 ATIF 检查。

## dsh 插件

所有与 DeepSeek Harness 相关的代码都留在 `apps/dsh-plugin`（`@rivus/dsh-estela`）内；插件通过 dsh 自身的 RPC 通道把 `createEstelaCore`（`@rivus/estela-server/core`）连接到 `<estela-workspace>`（`@rivus/estela-web/embed`），不为第二个 harness 引入抽象。

- **嵌入元素（`apps/web/src/embed/`）：**`<estela-workspace>` 将同一套 Solid `Workspace` 挂载到开放的 shadow root 中，不引入 DevFrame、会话浏览器、路由器或报告模式（独立 SPA 将其 DevFrame 客户端、连接监视器和「导出报告」按钮留在 `apps/web/src/shell/app-shell.tsx` 中）。宿主将 `source`（`WorkspaceSource`：`open()`、`event(traceId, id)`，配合 `NoLogError` 和 `StaleError`）设为 DOM 属性，并传入 `data-theme`、`lang` 以及可选的 `--estela-host-*` 自定义属性。`embed/stylesheet.ts` 拆分 Tailwind 编译出的 CSS，使顶层 `@property` 规则在每个文档中仅挂载一份引用计数的 `<style data-estela-shared>`（在最后一个元素断开时移除），其余规则全部留在 shadow root 内；`:host` 重置从宿主页面继承的样式（`all: initial`），通过 `--estela-host-*` 承接宿主 token 而不让宿主的 `:root` 变量渗入，同时保留 Estela 自己的事件类型配色（`--kind-*`）、字号和固定事件列表行高。嵌入构建（`vp build --mode embed` → `apps/web/dist-embed/`，由 `apps/e2e/src/e2e/embed.e2e.ts` 验证）会剥离 `@fontsource/*` 导入，不向宿主页面注入任何 `@font-face` 规则或字体文件。
- **宿主端（`apps/dsh-plugin/src/host/`）：**声明注入 `['connection', 'webServer', 'sessionPersistence']`，构建一个 `createEstelaCore` 实例（除非 `ESTELA_REDACT=0`，否则启用脱敏），并在 `ctx.effect` 内通过 `resolveConnectionRpc`（`src/host/rpc.ts`，先调用 `ctx.connection` 原型上的 `rpc` getter，以使 dsh `0.2.2-rc.5` 在插件自身的 `webServer` 作用域内注册通道路由，再回退到普通属性 `connection.rpc`）注册单一的一元通道 `/estela`。通道包含 `session/open`、`trace/view` 和 `trace/event` 三个端点（`src/contract/channel.ts`）；dsh 的浏览器连接不提供流式 RPC（`rpc.open`），因此加载时显示不定进度指示器，且读取在 dsh 的事件循环中执行（冒烟测试以 `DSH_LOAD_STALL_MS` 限制阻塞时长）。`session/open` 调用 `ctx.sessionPersistence.stat`（将 `SessionFormatUnsupportedError` 映射为 kit 风格的脱敏消息 `dsh: <path>:1: unknown format generation: <reason>`，并忽略 `location.kind`），然后以代理、路径、文件大小和 mtime 的哈希签发不透明 `traceId`（`src/host/sessions.ts`）。宿主保留最近签发的 16 个 id（多于 TraceStore 的 3 份缓存快照）并固定进行中的 id；冷读取和已缓存的 `originalUnavailable` 读取都会重新核对文件印记（配合 `TraceStore` 的 `ResolvedSession.expect` 保护），发生变化时返回 `estela/stale` 并丢弃该 id（保持相同大小与同一时间戳粒度的重写不会被察觉）。`trace/view` 获取不带 `owner` 的 `TraceStore` 持有引用（浏览器标签页共享同一个 owner 对端，避免一个标签页取消另一个标签页的加载），并在调用结束、中止信号触发或插件释放时释放（进行中的调用以 `estela/closed` 结束）。
- **客户端（`apps/dsh-plugin/src/client/`）：**使用不含 JSX 的 React 18（`createElement`）注册 `conversation.view` 插槽（`id: 'estela'`、`order: 60`、`label: 'Estela'`），通过 ref 在 `<estela-workspace>` 上设置 `source`（React 18 会把自定义元素上的对象 prop 序列化为特性），让 Solid 仅在 shadow root 内运行，而 `react` 来自 dsh 的模块加载器。`source.ts` 在每次 `open()` 时都重新调用 `session/open`（并发写入导致 `estela/stale` 时最多重试 3 次），并将 `estela/no-log` / `estela/stale` 映射为 `NoLogError` / `StaleError`。`appearance.ts` 将 `ctx.theme`（`active.colorScheme` 与 `--dsw-*` / `--ds-*` token）和 `ctx.locale`（`zh*` → `zh-CN`，其余为 `en`）映射到元素上的 `data-theme`、`lang` 和 `--estela-host-*`，绝不修改 `document.documentElement`，并在释放时清除自定义属性。`view-height.ts` 通过 `ResizeObserver` 和 `MutationObserver` 将外层 `div` 的像素高度设为最近纵向可滚动祖先的 `clientHeight` 减去该祖先内贴底覆盖层兄弟节点（如 dsh 的粘性输入框底座）的高度。

## 打包产物

`apps/cli` 通过 `vp pack` 构建为 `dist/bin.mjs`（检查 Node 版本后动态导入）和 `dist/cli.mjs`（打包所有 `@rivus/*` 包；`devframe` 和 `@devframes/agentic` 保留为运行时依赖）。网页构建产物复制到 `dist/web/`，`src/paths.ts` 通过构建时常量 `ESTELA_BUNDLE` 定位它。网页打包产物包含用于报告校验的 `zod/mini` 和 trace schema（gzip 后约 8 KB），以及 kit 的计价函数和 LiteLLM 价格快照（gzip 后约 8 KB）。`node scripts/check-budgets.mjs` 按 `scripts/budgets/budgets.mjs` 中的预算检查体积。上次设定预算时，网页 JS 和 CSS 原始体积为 426.1 kB、gzip 后为 124.2 kB，`dist/cli.mjs` 为 1,023.6 kB，打包后的 tarball 为 654.7 kB；同一检查打开一个 100 MB 的 Codex 会话直至返回 `get-trace-view` 用时 0.5 到 0.9 秒，峰值 RSS 为 400 到 500 MB。`apps/e2e` 从外部测试打包后的 tarball：`test:smoke`（CLI、S2、S10、S13、S15、S16 以及 MCP 工具的 S17 和 S18）和 `test:e2e`（Playwright 浏览器场景）。

`apps/dsh-plugin` 构建两份产物且不声明任何运行时 `dependencies` 或 `peerDependencies`（避免在 dsh 提升安装的 profile 中产生依赖冲突）：`dist/host.mjs`（由 `vp pack` 构建，打包 `@rivus/estela-server/core`、`@rivus/agent-kit`、`zod` 和 `es-toolkit`，测试确保既不导入 `devframe` 也不导入 `node:sqlite`）和 `dist/client.js`（由 `scripts/build-client.mjs` 构建为单个经典脚本，包装在 `window.__ModuleLoader__.load({ id: '@rivus/dsh-estela', factory(require) { ... } })` 中，仅保留 `react` 为外部依赖，内联不含字体的 `@rivus/estela-web/embed`，不做代码拆分）。包内同时发布 `cordis.patch.yml`（dsh 激活插件所必需）、`assets/icon.png` 和 `dist/THIRD-PARTY-NOTICES.txt`，不在宿主页面定义任何插件全局变量（仅保留浏览器的自定义元素注册）。`node scripts/check-budgets.mjs` 同样对 `dist/client.js`（原始体积与 gzip 体积）、`dist/host.mjs` 和插件 tarball 强制执行体积预算。

## 终端

`apps/cli/src/entry/` 是 CLI 的入口层。`routes.ts` 为 `@bomb.sh/router` 声明全部命令和选项，该路由器一次性解析命令行，并在读取任何会话前拒绝路由不接受的所有参数；`app.ts` 将选中的路由交给 `commands/` 中的对应模块（`dev.ts`、`build.ts`、`mcp.ts`、`export.ts`），`failure.ts` 将每种可预期的失败映射到其消息、修复建议行和退出码（所有失败均为 1）。只有 `entry/` 读取命令行、写入终端、打开浏览器以及设置退出码；`export/` 和 `packages/server` 各自抛出自己的错误。开发服务器通过 DevFrame 的 `createDevServer` 启动，`mcp` 通过其 `createMcpServer` 启动，两者都基于 `createEstelaServer` 返回的定义。在终端中，CLI 使用 `@clack/prompts`（`apps/cli/src/entry/ui/terminal.ts`、`index-progress.ts`）绘制输出：带名称和版本的启动行、各代理的索引进度、加载旋转指示器、`build` 步骤、在终端宽度足够时放入方框内的 URL（在支持的终端中为 OSC 8 链接），否则为单行 `Ready: <url>`，以及由原因加一行修复建议构成的错误提示。当 stdout 不是终端或设置了 `NO_COLOR` 时，上述环节改为输出纯文本行，且从每一行中剥离转义序列，包括 DevFrame 自身的 `[devframe]` 输出行（即使设置 `NO_COLOR` 它们也会打印颜色控制码）。`mcp` 只向 stdout 写入协议消息，其余所有内容全部写入 stderr。在没有交互式 stdin 时传入 `--pick` 会以 1 退出。CLI 和 MCP 输出仅提供英文。

## 信任

会话文件留在磁盘上。开发服务器绑定 localhost。索引保存标题、用户提示词（每条 500 个字符）、路径和数字，存放在用户缓存目录中且权限模式为 0600。无论 `ESTELA_REDACT` 如何设置，`build`、「导出报告」以及每条 MCP 工具结果和错误始终进行脱敏（主目录和令牌模式）；报告中仍保留会话文本和文件内容，并会明确提示。ATIF 和 OTLP 导出默认与服务器一样脱敏，设置 `ESTELA_REDACT=0` 可写出未脱敏的原始字节。脱敏逻辑由 kit 提供（`@rivus/agent-kit/redact`，由 `packages/server` 和 `apps/cli` 导入）：它替换字符串中出现的所有主目录拼写（也包括 git diff 标头 `a/<home>/…` 中的拼写）、去掉前导 `/` 的形式（`Users/<name>/…`）、JSON 转义形式（`\/Users\/<name>`）、Claude 的短横线拼接形式以及 Grok 的 `%2F` 形式，不区分大小写，覆盖值和键；更长的名称（`/Users/<name>x`、`/Users/<name>.bak`）保留原样。同一对象中脱敏后文字相同的两个键，各自的值都保留：后出现的键在显示名后加 `#2`、`#3`…，服务器和导出都是如此，因为键可能是代理记录的路径或令牌，值不能随键一起丢失。其令牌模式采用固定的前缀列表（`sk-`、`AKIA`/`ASIA`、GitHub、Slack、npm）和 PEM 私钥；其他形式的机密会原样通过，用户文档对此也有说明（见[隐私与脱敏](../guide/privacy.zh-CN.md#脱敏覆盖的范围)）。两个主目录不同时，服务器把两者都隐藏（`packages/server/src/sessions/redaction.ts`）：平台主目录（`platform.home`：代理根目录、索引，以及会话记录的内容，例如工作目录、标题或提示词）和进程主目录（`os.homedir()`：服务器自身产生的内容，例如报告构建的错误消息或导出路径，以及会话中记录的服务器运行用户的路径）。CLI 的平台主目录就是进程主目录，因此其输出只经过一次脱敏。`build --out-dir` 仅在目标目录为空或包含先前 Estela 报告时才替换已有目录（并在 DevFrame 的 `createBuild` 移除目录前拒绝 `/`、工作目录、主目录、符号链接、非目录以及其他非空目录）；「导出报告」始终创建新目录。除非设置 `ESTELA_REDACT=0`，开发服务器对视图 trace、`get-event`、错误消息和列表行一视同仁地执行脱敏。切勿将本机路径或真实机密放入夹具。

dsh 插件不自行注册 HTTP 路由、不启动独立进程、也不向磁盘写入任何内容（不写会话日志、dsh 文件或会话索引）。对 `/estela` 的调用先经过 dsh 自身的准入检查（无 cookie 返回 401，`Origin` 或 `Host` 不匹配返回 403），处理函数随后拒绝所有 `principal.kind` 不是 `owner` 的对端、捕获全部异常以防未脱敏错误透传到 dsh（插件自拟错误返回固定文案，其余返回经脱敏的 store 或格式错误消息），并除非设置 `ESTELA_REDACT=0` 否则像开发服务器一样执行脱敏。`dist/client.js` 与其他插件脚本一样由 dsh 在无 cookie 情况下下发，仅包含代码。

## 兼容性

[公共接口](../reference/public-interface.zh-CN.md)列出了 semver 覆盖与不覆盖的内容。规范 trace 文件格式、索引、打包后的服务器与网页应用之间的 RPC，以及各 workspace 包的导出均不保证稳定：它们会就地修改，不提供兼容层也不读取旧格式。更名为 Estela 之前的旧名称（`@rivus/agent-trace`、`AGENT_TRACE_*`、`schema: 'agent-trace'`、`rivus-agent-trace` 缓存）不再读取；它们仅保留在已发布的 `apps/cli/CHANGELOG.md` 条目、`.changeset/ledger.yaml` 以及 `v0.1.0` 标签中。

`@rivus/estela` 不导出编程 API，`@rivus/dsh-estela` 也不公开嵌入 SDK：`createEstelaServer`、`createEstelaCore` 以及 `<estela-workspace>`（`@rivus/estela-web/embed`）均仅限 workspace 内部使用。

## 当前查看器范围之外

尚未实现：⌘K 跳转面板（当前「转到事件列表」按钮只将焦点移至事件列表）以及 composer 覆盖层。

不支持的功能：

- [支持的代理](../guide/supported-agents.zh-CN.md)之外的代理；
- 实时跟随运行中的会话，以及编辑或重放会话；
- 超出标题和用户提示词范围的会话内容搜索；
- 代理自身记录的金额（见[费用](#费用)）；
- 按槽位划分的 Token 构成随时间变化（见[工作区](#工作区)）；
- 用于上下文差异或费用的 MCP 工具；
- 英文和简体中文之外的界面语言；
- 账号、上传或托管服务。
