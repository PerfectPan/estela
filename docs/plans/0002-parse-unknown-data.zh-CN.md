> 中文阅读版。以英文原文 docs/plans/0002-parse-unknown-data.md 为准。

# 用 schema 解析未知数据，并按 kind 为事件 payload 定类型

- 状态：已接受；PR A 实现 3.1 至 3.4，PR B 随后
- 负责人：PerfectPan
- 评审人：未确认
- 最后更新：2026-10-13
- 配套 Spec：无（技术重构，没有用户可见的行为变化）
- Issue：[#39](https://github.com/PerfectPan/agent-trace/issues/39)

agent-trace 在很多地方读取未知数据：来自 kit 和规范 JSON 文件的事件 payload、来自浏览器和 MCP 的 RPC 输入、SQLite 行、捕获的错误、DevFrame dump 文件和包清单。这些读取大多使用手写形状守卫（`asRecord`、`asString`、`asNumber`、`typeof` 级联），或者什么都不检查的类型断言。本计划替换它们：未知数据在边界处用 `zod/mini` 解析一次；每个值跑一次 schema 太慢的地方改用 es-toolkit 谓词；边界之后的代码读取有类型的值。交付分两个 PR。PR A 解析边缘的输入（RPC、会话索引、CLI 的文件和进程 API），不改共享类型。PR B 在 kit 已定类型的 `TranscriptEvent` 之上按 kind 为事件 payload 定类型，并删除 kernel 的 helper。

## 目录

1. 背景与目标
2. 概要
3. 详细设计
4. 上线与稳定性
5. 验证
6. 执行计划
7. 风险、待定问题与后续工作
8. 附录 A：清单
9. 附录 B：测量数据

## 1. 背景与目标

### 1.1 现状与约束

在 `main` 的 `3f100ad` 上测量，并在 `a0aba04` 上复测；此前 #41 把 `host` 改名为 `agent`，#42 把工具链迁到 Vite+。

- **事件 payload。** `TraceEvent.payload` 是 `z.record(z.string(), z.unknown())`。kernel 在 `fold`、`lanes`、`project-timeline`、`project-turns` 和 `reconstruct` 中通过 `asRecord`（lodash `isPlainObject` 加类型断言）、`asString` 和 `asNumber` 读取它；web 应用在 `event-text.ts`、`ledger-model.ts` 和 inspector 中做法相同。`prompt-snapshot.ts` 不经检查就把 payload 断言为 `PromptSnapshotPayload`，`view.ts` 的 `Capper.value` 用 lodash `isObjectLike` 加类型断言遍历 payload。
- **kit。** trace 目前使用 0.11.0；到这个版本为止，kit 的 `TranscriptEvent.payload` 是 `Record<string, unknown>`，各 kind 的接口没有与 `kind` 绑定。kit #98 于 2026-10-13 随 0.12.0 发布，把 `TranscriptEvent` 改成按 `kind` 区分的联合类型：按 `kind` 收窄后，`payload` 的类型就是该 kind 的 `*Payload`（`TranscriptEventOf<K>`、`TranscriptEventPayloads`）。同日发布的 0.13.0 和 0.14.0 保留这些类型：0.13.0 增加 kit #89 的 opencode bridge 改动，通过 bridge 传递当前会话 id；0.14.0 是 PR B 要安装的版本，增加检查进程锁是否被持有的能力（kit #108）。kit 在自己的边界用 `zod/mini` 解析 agent 记录。
- **RPC 输入。** `list-sessions`（`checkQuery`）和 `export-report`（`checkInput`）用 `typeof` 级联和类型断言检查输入。`load-trace`、`get-trace-view`、`get-event` 和 `reconstruct` 不经检查直接解构输入。DevFrame 根据 handler 签名为 `call()` 定类型（`packages/rpc/src/index.ts` 中的模块扩充）。
- **存储行和错误。** `runtime-node` 通过类型断言、`readNumber`、`String(row.x)` 和 `Number(row.x)` 读取 SQLite 行；通过 `typeof` 和 `every(typeof)` 读取 `context_shape`；通过 `(error as { … })` 读取 `errcode` 和 `EEXIST`。sqlite 警告过滤器把 `process.emitWarning` 的参数当作 `unknown` 读取并做类型断言。
- **CLI 文件。** `report-site.ts` 对 DevFrame 的 dump 清单和记录做类型断言，`scripts/third-party-notices.ts` 把 `JSON.parse` 的输出当作有类型的清单返回，`terminal.ts` 对其 `stream.write` 包装函数的剩余参数做类型断言。
- **库。** `zod` 4.6.5 是 `packages/schema` 的依赖；es-toolkit 1.52.0 经由 kit 已在 lockfile 中。web 包中没有 zod：`3f100ad` 时为 286.8 KB 原始大小 / 94.6 KB gzip。
- **约束。** AGENTS.md：缺失的数据是 `unavailable`；adapter 显式失败，不丢弃事件；会话读取归 kit，只有 `apps/cli` 在运行时导入它；其他包用 `import type` 使用 kit 类型，不复制。web 应用和测试解析的错误消息逐字节不变。MCP 冒烟测试用 `arguments: { eventId }` 调用 `reconstruct`。

### 1.2 问题

手写守卫在每次读取时重述一遍形状，并与生产方逐渐脱节：web 有三处读取（`tool_result.text`、`compaction.summary`、`tool_result.durationMs`）读的是没有任何生产方写入的字段。类型断言什么都不检查，所以格式错误的 RPC 输入或存储行会到达假定其类型的代码。负责人的 TypeScript 评审规则和 kit 的编写规则都禁止这两种写法；守卫只允许属于四类例外之一。

### 1.3 目标与成功标准

- 5.1 中的 grep 只找到有文档的例外类别（品牌 symbol 守卫、深冻结 helper、对已知联合类型的收窄、`WeakSet`/`WeakMap` 簿记），每处都有注释写明原因；此外只剩 PR 未改动文件中的测试代码。
- 对格式正确的输入行为不变：现有测试、CLI 冒烟套件和 e2e 套件通过；3.1 列出的错误消息逐字节不变，并由测试固定。
- PR A 不改变 web 包。PR B 记录 web 构建前后的结果。

### 1.4 非目标

- 根目录下无依赖的 `scripts/*.mjs`（不安装依赖、没有类型、输入归仓库所有）。
- PR 未改动文件中的测试和 e2e 代码。
- 传输层接口定义：handler 的参数和结果类型保持不变。
- DevFrame 的 `args` 选项（见 D5）。
- 对格式正确的数据引入新行为。

## 2. 概要

### 2.1 设计原则

- 在边界解析一次，之后读取有类型的值。边界之后的读取只收窄已知联合类型，不做其他检查。
- trace schema 只校验并保留原值：由 schema 实现的守卫返回输入本身，所以对象身份和键顺序不变。
- 客户端或测试会解析的每条消息逐字节不变。
- 会话读取归 kit，所以 payload 类型也归 kit。trace 只添加自己的字段（视图的 `$truncated` 和快照引用）。

### 2.2 边界与职责

| 边界 | 负责方 | 解析方式 | PR |
|---|---|---|---|
| Agent 记录 → `TranscriptEvent` | kit adapter | kit 的 `zod/mini` schema；从 0.12.0 起按 kind 定类型 | kit #98 |
| kit `Transcript` → `Trace` | `apps/cli` `transcript-trace.ts` | 不解析：kit 的类型已按 kind 携带 payload | B |
| 规范 JSON 文件 → `Trace` | `apps/cli` `session.ts` | `isTrace`（schema 守卫），现在也检查 payload | B |
| `Trace` → 视图 trace | kernel `toView` / `fitView` | 对选定的视图执行一次 `isTrace` | B |
| `index.html` 中的报告 JSON | web `shell/report.ts` | `isReportTrace`（schema 守卫） | B |
| RPC 输入（浏览器、MCP） | rpc handler | 每个 handler 内的 `zod/mini` | A |
| 原始记录（`fingerprint`） | rpc `source-check.ts` | es-toolkit `isPlainObject`、`isPrimitive` | A |
| SQLite 行、错误、`emitWarning` 参数 | runtime-node | `zod/mini` 行 schema；Node 的重载类型 | A |
| dump 文件、包清单、`stream.write` 参数 | `apps/cli` | `zod/mini`；`Writable.write` 的重载类型 | A |

### 2.3 主路径

```text
agent log -- kit adapter (zod/mini) --> TranscriptEvent (typed by kind) --> Trace (same objects, no parse)
canonical JSON file -- JSON.parse --> isTrace (payloads checked) ------------> Trace (typed)
                                          \-- fails: fall through to the kit (unchanged)
Trace -- fitView: draft per cap step --> isTrace once on the chosen view ----> view Trace (typed, memoized)
view Trace -- DevFrame RPC (typed contract) ---------------------------------> web (no re-parse)
report-trace JSON in index.html -- JSON.parse --> isReportTrace ------------> web report mode
RPC inputs (browser, MCP) -- zod/mini parse in handler ----------------------> typed handler input
SQLite rows / errors / warnings / dump files -- zod/mini or typed overloads -> typed values
```

### 2.4 设计决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | `TraceEvent` 改为按 `kind` 区分的联合类型，由 kit 的 `TranscriptEventPayloads`（`import type`）加上 trace 的视图字段构成。`EventOf<K>` 指代某一个 kind。读取方按 `event.kind` 收窄（对已知联合类型的收窄，属于允许的例外）。 | 解析一次，之后有类型，每次读取没有额外开销。带类型的访问器要么每次读取都重新解析（投影在浏览器中对每个 trace 运行多次），要么缓存在 `WeakMap` 中，要么做类型断言，而且在调用处无法收窄。基于 kit 的类型让每种 payload 只有一份定义（AGENTS.md：不要复制 kit 类型）。 |
| D2 | `packages/schema` 为 JSON trace 读取提供每个 kind 的 `zod/mini` schema：payload 用 `z.looseObject`，声明 kit 已声明的字段，未声明的字段保留给 Input 标签页；每个 payload 都有 `$truncated?`，`system` 还有 `systemPromptSameAs?` 和 `toolsSameAs?`。一个编译期检查把每个 payload schema 的输出与 kit 的 payload 类型绑定。`promptSnapshot()` 收窄 `kind === 'system'` 并像 kit 那样比较 `type`，不做类型断言。 | 规范文件和报告 JSON 是不可信的 JSON，需要 kit 类型给不了的运行时检查。payload 普查（附录 B）在 `system` 上发现 9 个未声明的键、在 `hook` 上发现 3 个，inspector 目前会显示它们。 |
| D3 | trace schema 是纯校验器（没有默认值、`catch` 或转换）。调用方通过 schema 守卫（`isTrace`、`isTraceEvent`）保留已校验的输入，而不是使用 `.data`。 | zod 的输出会重排键（先 shape，再其他键）并复制每个 payload 外壳。守卫保留对象身份和键顺序，所以 Input 和 Output 标签页以及规范 fixture 的 `toEqual` 逐字节不变，开销相同。 |
| D4 | 解析点：(a) 规范文件快速路径 `isTrace` 检查 payload，检查失败的文件仍然交给 kit；(b) `transcriptToTrace` 映射 kit 已定类型的事件，不解析也不做类型断言；(c) `toView` / `fitView` 对最终视图检查一次，而不是每个 `fitView` 步骤检查；(d) 报告模式对 `<script id="report-trace">` 做守卫检查。实时 RPC 结果不重新解析。 | (b) kit 在自己的边界解析，其从 0.12.0 起的类型把每个 payload 与其 kind 绑定，再解析一次只是重复（见 D10）。(c) `Capper.value` 返回 `unknown`。(d) `JSON.parse` 的输出。RPC：两端在同一个 tarball 中发布，服务端已在 (a)、(b) 或 (c) 处检查过该值。 |
| D5 | RPC 输入在每个 handler 内用 `zod/mini` 解析；每个检查上的 `error` 参数携带现有消息，抛出时使用第一个 issue 的消息和现有的错误类。此前不经检查接收 `{ ref }`、`{ ref, id }` 或 `{ ref?, eventId }` 的四个 handler 也获得 schema。handler 参数类型仍是客户端的接口定义。不使用 DevFrame 的 `args` 选项。 | DevFrame `args` 只做守卫式校验，并在 MCP 接口上公布位置参数 `arg0`：`reconstruct` 会因此期望 `{ arg0: { eventId } }`，破坏冒烟测试固定的 MCP 调用。它还会把消息包进 DF0043，并且不能做规整（`null` → `{}`、宽松的 `locale`）。 |
| D6 | 对任意 JSON 的通用热路径遍历（`fingerprint`、`Capper.value`）使用 es-toolkit 的 `isPlainObject` 和 `isPrimitive`（类型守卫），然后做已知联合类型的 `typeof` 判断；在这里逐节点跑 zod 太慢。单个值（错误、RPC 输入、行、显示用参数）使用 `zod/mini`。kernel 去掉 lodash-es。 | 对 81k 条原始记录跑 `fingerprint`：es-toolkit 写法与手写写法相差不到 2%；每个值一个 zod schema 慢 2.7 倍（附录 B）。所有写法的哈希相同。 |
| D7 | SQLite 行用每个 SELECT 一个的 `zod/mini` 行 schema 解析（可空列用 `z.nullable`）；`HEAD_SELECT` 和 `SUMMARY_SELECT` 由 schema 的键生成。索引是缓存：头部解析失败的行由 `rows` 或遇到它的 `writeHead` 连同其 prompt 和搜索行一起删除，下一次 discover 重新写入；摘要解析失败时 `get` 不返回它。`context_shape` 在 `try` 中 `JSON.parse`，然后用 `z.array(z.number())`；损坏的 shape 只丢失 shape。`errcode` 和 `EEXIST` 通过 `z.object` schema 读取，`errcode` 通过唯一的 `sqliteErrcode`。 | 存储记录属于规则的输入范围；`node:sqlite` 把行的类型定为 `Record<string, SQLOutputValue>`，原来的类型断言未经检查就收窄了它。 |
| D8 | zod/mini 在 PR B 中进入 web 包：`3f100ad` 时上限为 +39.3 KB 原始大小 / +9.5 KB gzip（trace 和报告的 schema 与解析），PR B 在 Vite+ 构建上重新测量。不设体积预算。 | 报告守卫在浏览器中解析 JSON，而从 schema 模块导入任何值都已经会带入 6.3 KB gzip（顶层的 schema 构造不会被 tree-shake）。负责人已接受。 |
| D9 | 两个 PR：先 PR A（边缘的输入，不改共享类型），再 PR B（端到端的有类型 payload）。不设兼容垫片。 | 删除 kernel helper 并修改 `TraceEvent` 会让 web 应用编译失败，直到其读取方修改完毕，所以 PR B 是一个 PR；PR A 与它无关。 |
| D10 | kit 优先：kit 先于 trace 按 kind 为 payload 定了类型（kit #98，从 0.12.0 起）。PR B 把 trace 升级到 kit 0.14.0，基于 `TranscriptEventPayloads` 构建 `TraceEvent`，并去掉本设计最初计划在 `transcriptToTrace` 中做的逐事件守卫。`packages/schema` 获得对 kit 的仅类型依赖，与其他包一致。 | 那个守卫只因 kit 的 payload 类型宽松而存在。有了 kit 的联合类型，守卫只会在加载时白白重新检查每个 kit 事件（每个约 2 µs，见附录 B）；本设计初稿当作风险接受的“kit payload 不匹配导致加载报错”，在出现 kit 类型错误之前不会发生。 |

## 3. 详细设计

### 3.1 RPC 输入（PR A）

`packages/rpc/src/functions/parse-input.ts` 提供 `parseInput(schema, input, ErrorType = TypeError)`：先 `z.safeParse`，失败时用第一个 issue 的消息抛出 `ErrorType`。传给它的每个 schema 都在每个检查上设置了 `error`，所以这条消息就是完整的消息。zod 的对象解析按 shape 顺序报告 issue，与手写检查的执行顺序相同。每个 handler 保留其参数类型，并在其他代码读取 `input` 之前解析它。

| Handler | 输入 | 格式错误时的消息 | 错误类 |
|---|---|---|---|
| `list-sessions` | 不是对象（`null` 和 `undefined` 视为 `{}`） | `list-sessions: expected an object` | `TypeError` |
| `list-sessions` | `query` 不是至多 1000 个字符的字符串 | `list-sessions: query must be a string of at most 1000 characters` | `TypeError` |
| `list-sessions` | `since` 不是非负整数 | `list-sessions: since must be a non-negative integer` | `TypeError` |
| `list-sessions` | `first` 不是至多 500 个字符串的数组 | `list-sessions: first must be an array of at most 500 refs` | `TypeError` |
| `export-report` | 没有非空字符串 `ref` | `export-report needs a session ref` | `Error` |
| `load-trace` | 没有字符串 `ref` | `load-trace needs a session ref`（新增） | `TypeError` |
| `get-trace-view` | 没有字符串 `ref` | `get-trace-view needs a session ref`（新增） | `TypeError` |
| `get-event` | 不是对象 / 没有字符串 `ref` / 没有字符串 `id` | `get-event needs a session ref and an event id` / `get-event needs a session ref` / `get-event needs an event id`（新增） | `TypeError` |
| `reconstruct` | 不是对象或没有字符串 `eventId` / `ref` 既不是字符串、`null`，也不是缺省 | `reconstruct needs an event id` / `reconstruct: ref must be a string; leave it out for the current session`（新增） | `TypeError` |

前五行是现有的消息和错误类。字符串 `ref` 仍原样到达 store，所以 `unknown session ref: …`、`no event … in …` 和 `load of … was cancelled` 保持不变。`export-report` 与以前一样忽略 `en` 和 `zh-CN` 以外的 locale。`since` 使用 `z.int()`，即安全整数范围，比 `Number.isInteger` 略窄；修订号从 0 开始递增，永远不会接近 2^53。

### 3.2 通用 JSON 遍历

`fingerprint`（PR A）用 `isPlainObject` 检查记录，用 `isPrimitive` 检查每个顶层值，再用 `typeof` 收窄已知的原始类型联合。原始记录来自 `JSON.parse`，所以每条记录都是普通对象，哈希不变。`Capper.value`（PR B）保持原有结构（字符串、数组、记录、其他），用 `Array.isArray` 和 `isPlainObject` 判断容器。与 `isObjectLike` 的唯一区别是不再遍历非普通对象（类实例、`Date`、`Map`）；payload 的值来自 `JSON.parse` 或对象字面量，所以不存在这类对象。`toView` 构建一个草稿，其 session 和事件对类型系统而言是 `unknown`，并通过 `isTrace` 返回它；`fitView` 在每个截断步骤测量草稿，只检查最终选定的那个。检查失败就抛出：截断把字符串变成字符串，只重命名长于截断长度的键，而没有任何已声明的键这么长。

### 3.3 会话索引的行和错误（PR A）

```ts
const textColumn = z.nullable(z.string())
const numberColumn = z.nullable(z.number())
const headRow = z.object({
  ref: z.string(), agent: z.string(), path: z.string(), size: z.number(), mtime: z.number(),
  session_id: textColumn, title: textColumn, cwd: textColumn, first_prompt: textColumn,
  started_at: numberColumn, last_active_at: numberColumn,
})
const summaryRow = z.object({
  summary_version: numberColumn, turns: numberColumn, requests: numberColumn, tokens_in: numberColumn,
  tokens_out: numberColumn, duration_ms: numberColumn, compactions: numberColumn, subagents: numberColumn,
  failed_tools: numberColumn, context_shape: textColumn,
})
const HEAD_SELECT = Object.keys(headRow.shape).join(', ')
```

`rows` 分别用 `headRow` 和 `summaryRow` 解析每一行：头部有问题就删除这一行，摘要有问题只丢弃摘要。`rows` 和 `writeHead` 也查询 `id`，删除时在 SQL 中通过存储的 `ref` 匹配 prompt，所以 `ref` 解析失败的行也会删掉它的 prompt。`rows` 的删除在读取之后才开始的写事务中进行，所以它在该事务内按 `id` 重新读取每个这样的行，只有头部仍解析失败时才删除：在此期间，另一个进程的 `writeHead` 可能已在同一 `id` 下写入了有效的行。这次删除是可选的：无论因何失败（忙、磁盘满、只读、I/O），`rows` 都仍返回已读到的行，该行保持隐藏，由 `writeHead` 删除。较小的 SELECT（`id`；`ref`；`text`）各有自己的行 schema；解析失败的搜索行或 prompt 行被跳过。`PRAGMA user_version` 和 `count(*)` 也经过行 schema；解析失败的版本号视为 0，于是 `prepare` 在空文件中创建 schema，或者重建文件。`sqliteErrcode(error)` 就是 `z.safeParse(z.object({ errcode: z.number() }), error).data?.errcode`，打开路径（精确错误码）和搜索（用 `0xff` 屏蔽的扩展错误码）都使用它。重建锁上的 `EEXIST` 用 `z.object({ code: z.literal('EEXIST') })` 判断。

### 3.4 CLI 文件和进程 API（PR A）

- `report.ts`：`reserveDir` 通过同样的 `z.object({ code: z.literal('EEXIST') })` 读取 `EEXIST`（每个包各有一行 schema，不共享导出）。
- `report-site.ts`：dump 清单 schema 只读取 `agent-trace:report-trace` 条目（`records`、`fallback`）；记录 schema 是错误记录（`error.message`）与输出记录（`output`，类型为 `unknown` 但必须存在，原样嵌入）的联合；DevFrame 对失败的调用只写 `error`，不写 `output`。清单解析失败即视为“没有记录”，使用现有消息。
- `terminal.ts`：`stream.write` 包装函数把剩余参数的类型定为 `Writable.write` 两个重载的尾部参数（`[callback?]` 或 `[encoding, callback?]`；Node 也接受 `null` 或 `undefined` 的 encoding），并作为已知联合类型收窄，包装函数及其参数都不做类型断言：两个位置中是函数的那个就是 callback，只有字符串才是 encoding。解码后的二进制块与以前一样只传递 callback。
- `scripts/third-party-notices.ts`：`z.object` 清单 schema（`name`、`version`、`dependencies`、`optionalDependencies`、`bundledVersions`）；`license` 单独用 `z.string()` 读取，所以旧的对象形式仍读作 "see package"。清单解析失败会让构建失败，并给出包路径和第一个 issue。
- `runtime-node/suppress-sqlite-warning.ts`：参数类型按 Node 的 `emitWarning` 重载定义（`[warning: string | Error, typeOrOptions?: string | EmitWarningOptions | Function, ...rest]`）；警告类型取自 `Error` 警告的 `name`，否则取自字符串或选项参数。kit 的 `platform-node/src/sqlite.ts`（0.13.0）有相同的过滤器，但它是 kit 自己的 `loadSqlite` 的私有实现，只包住 kit 的 `getBuiltinModule` 调用，并且只匹配类型参数。trace 的过滤器必须在 `bin.mjs` 链接导入 `node:sqlite` 的模块图之前安装，而 runtime-node 不能在运行时导入 kit，所以 trace 保留自己的副本。

### 3.5 事件 payload（PR B）

- **类型。** `TraceEvent` 是 `{ [K in EventKind]: TraceEventBase<K> & { payload: TranscriptEventPayloads[K] & ViewFields<K> } }[EventKind]`，其中 `ViewFields` 为每个 kind 添加 `$truncated?`，为 `system` 添加 `systemPromptSameAs?` 和 `toolsSameAs?`。`EVENT_KINDS` 与 kit 的 `TRANSCRIPT_EVENT_KINDS` 列出相同的 kind（编译期检查）。导出的 payload 类型变为 kit 类型（`ToolCallPayload`、`SystemPayload` 等）加上各自视图字段的别名；`PromptSnapshotPayload` 是 kit 的类型加上 `system` 的视图字段。
- **Schema。** `traceEventSchema` 是 `z.discriminatedUnion('kind', …)`，每个 kind 一个成员，每个 payload 是基于 kit 已声明字段的 `z.looseObject`（见下方草图）；`isTraceEvent` 和 `isTrace` 是 schema 守卫（D3）。编译期检查断言每个 payload schema 的 `z.output` 可赋值给该 kind 的 kit payload 类型加 `ViewFields`。
- **映射。** `transcriptToTrace` 把 kit 的事件直接赋给 `Trace.events`，不复制、不解析、不做类型断言。
- **Kernel。** 删除 `asRecord`、`asString` 和 `asNumber`；读取方按 `kind` 收窄（`event.kind === 'request' ? event.payload.usage?.inputTokens : undefined`）。`promptSnapshot` 在 `type === 'prompt_snapshot'` 时返回 `system` payload，不做类型断言。`view.ts` 按 3.2 修改；kernel 去掉 lodash-es，加入 es-toolkit。
- **Web。** 读取方按 `kind` 收窄；删除 `numberField`。删除那三处读取无人写入字段的代码。`toolTarget` 用显示用 schema 解析它的那一个参数（`z.union([z.string(), z.record(z.string(), z.unknown())])`，每个键 `z.union([z.string(), z.array(z.string())])`）。`messageOf(error)` 就是 `z.safeParse(z.object({ message: z.string() }), error).data?.message ?? String(error)`，替换 inspector 的 `(x.error as Error | undefined)?.message`。报告模式用 `isReportTrace`（trace schema、对照 kit 的 `SessionSummary` 检查的摘要、事件详情）守卫其 JSON，失败时用第一个 issue 抛出。`load-session.ts` 获得一个带三个有类型方法（`loadTrace`、`traceView`、`event`）的接缝，不再对 `call` 做类型断言。
- **生成器。** `scripts/generate-trace.mjs` 在 hook 上写入 `type`，hook schema 要求这个字段。

```ts
const viewFields = { $truncated: z.optional(z.array(truncatedPathSchema)) }

export const toolCallPayloadSchema = z.looseObject({
  callId: z.string(),
  name: z.string(),
  title: z.optional(z.string()),
  args: z.optional(z.unknown()),
  ...viewFields,
})
// message (user, assistant), reasoning, tool_result, request (usage typed, usageByModel typed),
// system (snapshot fields and *SameAs optional), compaction, hook (type required), unknown (type required): same pattern.

export const traceEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...eventFields, kind: z.literal('user'), payload: messagePayloadSchema }),
  // one member per EVENT_KINDS entry
])

/** Schema guard: callers keep `value` itself (identity and key order unchanged). */
export function isTraceEvent(value: unknown): value is TraceEvent {
  return z.safeParse(traceEventSchema, value).success
}
```

### 3.6 兼容性与失败

- 两个 PR 中，格式正确的输入行为都与以前相同。以前蒙混过关的格式错误输入现在会得到消息：不带 `eventId` 的 `reconstruct` 调用以前返回 `eventId: undefined` 的 `completeness: 'unavailable'`，现在抛出 `reconstruct needs an event id`；`list-sessions` 拒绝超过 2^53 的 `since`。既没有 `output` 也没有 `error` 的 `report-trace` 烘焙记录以前就会让构建失败，报的是 `jsonSafe(undefined).replaceAll` 处的 `TypeError`；新增的只是消息 `… is not an output or an error`。`report-trace` 以快照 dump 烘焙，handler 抛错时构建在写出任何记录之前就已失败，所以对它来说错误记录分支只是一道保险。
- 存储的索引行中某个值类型不对时（只有损坏或手工编辑过的缓存才会这样），以前读出时该字段缺失；现在不返回该摘要，或删除头部有问题的行，由下一次 discover 或摘要计算重写。
- PR B：payload 与其 kind 不匹配的规范文件（例如没有 `type` 的 hook，只有旧的 `generate-trace.mjs` 会写出）无法通过 `isTrace`，像任何非 trace JSON 一样交给 kit。不设兼容垫片：目前没有任何发布。

## 4. 上线与稳定性

### 4.1 门禁与上线阶段

不发布任何东西。每个 PR 带一个类型为 `none` 的 Rush change file（没有用户可见变化），在 6.4 的门禁通过后合入。

### 4.2 回滚

回滚该 PR。两个 PR 都不改索引布局或任何存储格式，所以回滚不需要数据迁移。

## 5. 验证

### 5.1 功能检查

完成条件 grep，预期只找到例外类别（每处带注释）、单独合入 PR A 时属于 PR B 的位置，以及未改动文件中的测试代码：

```sh
git grep -nE "asRecord|asString|asNumber|isRecord|plainRecord|readNumber" -- apps packages
git grep -nE "typeof [^=]*(===|!==) ?[\"']object[\"']|instanceof Object|Object\([^)]*\) ===|isObjectLike" -- apps packages
git grep -nE "as unknown as|as Record<string, ?unknown>|error as \{|JSON\.parse\([^;]*\) as [A-Z{]" -- apps packages ':!*.test.ts' ':!apps/e2e' ':!packages/rpc/testing'
```

固定行为的测试：kernel `fold`、`projections`、`reconstruct`、`view`、`view-snapshots`；cli `session-conformance`、`session-view`、`session.test`（规范 fixture 与文件 `toEqual`）、catalog 和索引测试；rpc trace-store 测试；web `ledger-model`、`load-session`。

PR A 新增：

- rpc `handler-input.test.ts`：3.1 中的每条消息和错误类，`list-sessions` 的 `null` / `undefined` / 未知键，被忽略的 locale，原样传给 store 的字符串 ref，以及不带 ref 或带 `ref: null` 的 `reconstruct`。`list-sessions` 和 `export-report` 的用例对它们所替换的手写检查同样通过。
- runtime-node：为 NULL 的头部列读作缺失字段；损坏的 `context_shape` 只丢失 shape；非数字的计数丢失缓存的摘要；有问题的头部让该行连同其 prompt 和搜索行被删除（由 `rows` 删除，或由在新 ref 下遇到它的 `putHeads` 删除），直到 `putHeads` 重写它；另一个索引在 `rows` 读取与删除之间于同一 `id` 下重写的行会被保留，删除因忙以外的错误失败时 `rows` 仍返回已读到的行；`sqliteErrcode` 从真实的 `node:sqlite` 错误上读出 `SQLITE_BUSY`（5）。警告过滤器的测试不加修改，在新的类型签名下运行。

PR B 新增：

- schema：每个 kind 接受 kit 的形状并保留额外的键；拒绝没有 `callId` 的 `tool_call`、没有 `type` 的 `hook`、非数字的 `usage.inputTokens`；接受 `$truncated` 和 `*SameAs` 字段；`isTrace` 拒绝有问题的 payload；守卫返回同一个对象。
- web：报告守卫拒绝格式错误的报告；`messageOf`（`Error`、`{ message }`、其他）；`toolTarget`（字符串、带 `command` 的记录、argv 数组、其他 → JSON 预览）。
- 差分证据（临时脚本）：对每个 fixture 和普查用到的本机会话，旧代码树与新代码树在 `fold`、`projectLanes`、`projectTurns`、每个 `request` 事件处的 `reconstruct`、`fitView` 输出，以及 web 每个事件的 `rowText` / `inputText` / `outputText` 上深度相等。

### 5.2 端到端验收

CLI 冒烟套件（S2、带 MCP `reconstruct { eventId }` 调用的 S10、S13、S15、S16）和 e2e 套件（S8 生成的规范 trace、S12 350 MiB）在打包后的 tarball 上通过，使用 `AGENT_TRACE_E2E_CHANNEL=chrome`。

## 6. 执行计划

### 6.1 前置条件

- PR A：`main` 在 `a0aba04` 或之后（agent 改名和 Vite+ 已合入）。
- PR B：PR A 已合入。`@rivus/agent-kit` 0.14.0 可以立即安装：kit 在 `minimumReleaseAgeExclude` 中（`common/config/rush/pnpm-config.json`）。

### 6.2 完成约定

- PR A：任务 A1 至 A5 完成；5.1 的 grep 在 rpc、runtime-node 和 `apps/cli` 中找不到例外类别之外的位置；6.4 的门禁通过；`check-browser-bundle` 在 zod 和 es-toolkit 打包进 rpc 后通过；web 构建不变。
- PR B：任务 B1 至 B6 完成；grep 只找到例外类别；差分证据显示没有差异；PR 中记录 web 构建前后的结果；本计划的长期约束移入 AGENTS.md 和 `docs/architecture/overview.md` 后删除本计划。

### 6.3 执行顺序

#### 任务 A1：依赖

- 文件：`packages/rpc/package.json`、`packages/runtime-node/package.json`、`apps/cli/package.json`、`common/config/rush/pnpm-lock.yaml`。
- 改动：给 rpc 和 runtime-node（`dependencies`）以及 `apps/cli`（`devDependencies`，打包进产物）加入 `zod` 4.6.5（与 `packages/schema` 相同）；给 rpc 加入 es-toolkit 1.52.0。执行 Rush update。`check-layers` 只约束 `@rivus/*` 包，因此无需修改。
- 测试：无。
- 退出条件：`rush install` 干净；lockfile 只新增这些 importer 条目。

#### 任务 A2：rpc

- 文件：`packages/rpc/src/functions/{parse-input,list-sessions,report,trace-view}.ts`、`packages/rpc/src/report.ts`、`packages/rpc/src/source-check.ts`、`packages/rpc/src/functions/handler-input.test.ts`。
- 改动：3.1 以及 3.2 中 `fingerprint` 的部分；`ReportLocale` 来自 `REPORT_LOCALES` 列表，locale schema 复用该列表。
- 测试：`handler-input.test.ts`（5.1）。
- 退出条件：rpc 测试通过；`list-sessions` 和 `export-report` 的用例对旧 handler 同样通过。

#### 任务 A3：runtime-node

- 文件：`packages/runtime-node/src/{session-index,session-index-schema,suppress-sqlite-warning}.ts`、`packages/runtime-node/src/session-index.test.ts`。
- 改动：3.3 以及 3.4 中的警告过滤器。
- 测试：5.1。
- 退出条件：runtime-node 测试通过，包括用 Node 类型擦除加载 `session-index.ts` 的多进程测试。

#### 任务 A4：CLI

- 文件：`apps/cli/src/{report,report-site,terminal}.ts`、`apps/cli/scripts/third-party-notices.ts`。
- 改动：3.4。
- 测试：现有的 `terminal`、`report-site` 和构建测试。
- 退出条件：`rush build` 与以前一样写出 `THIRD-PARTY-NOTICES.txt`；report-site 测试通过。

#### 任务 A5：规则与计划

- 文件：`AGENTS.md`、根目录 `vite.config.ts`（`typescript/no-unsafe-type-assertion` 上的注释）、`docs/plans/0002-parse-unknown-data.md`、`docs/plans/0002-parse-unknown-data.zh-CN.md`、`docs/plans/README.md`、一个类型为 `none` 的 Rush change file。
- 改动：AGENTS.md 规则（在边界解析未知数据；四类例外）；本计划及其中文阅读版。
- 测试：`check-doc-translations`。
- 退出条件：6.4 的门禁通过。

#### 任务 B1：kit 0.14.0 与 schema 层

- 文件：每个列出 `@rivus/agent-kit` 的 `package.json`、`packages/schema/package.json`、`scripts/check-layers.mjs`、`AGENTS.md`（分层表）、`docs/plans/0001-external-release.md` 2.2。
- 改动：kit 0.14.0；`packages/schema` 可以为了类型依赖 kit（只用 `import type`，lint 规则已在 `apps/cli` 以外强制这一点）。
- 测试：在新 kit 上运行现有套件。
- 退出条件：`rush install`、typecheck 和测试通过；`check-layers` 通过。

#### 任务 B2：schema

- 文件：`packages/schema/src/{types,index}.ts` 及其测试。
- 改动：3.5 的类型和 schema；重写“trace 不会因 payload 内容被拒绝”的那段注释。
- 测试：5.1 中的 schema 测试。
- 退出条件：schema 测试通过；随之出现的 kernel 和 web 编译错误正是 B4 和 B5 要修改的读取方。

#### 任务 B3：CLI 映射与生成器

- 文件：`apps/cli/src/transcript-trace.ts`、`scripts/generate-trace.mjs`。
- 改动：3.5 中的映射；hook 带上 `type`。
- 测试：`session-conformance`、`session.test`。
- 退出条件：cli 测试通过。

#### 任务 B4：kernel

- 文件：`packages/kernel/src/{jsonl,index,fold,lanes,project-timeline,project-turns,reconstruct,prompt-snapshot,view}.ts`、`packages/kernel/package.json`。
- 改动：3.5 的 kernel 部分和 3.2 的 `Capper.value`；去掉 lodash-es，加入 es-toolkit。
- 测试：kernel 套件；测试中的事件构造改用 `traceEventSchema` 的类型。
- 退出条件：kernel 测试通过。

#### 任务 B5：web

- 文件：`apps/web/src/lib/{event-text,ledger-model,error-message,tab-text,preview}.ts`、inspector、ledger 和 turn-header 组件、`apps/web/src/shell/report.ts`、`apps/web/src/workspace/load-session.ts`、`apps/web/package.json`。
- 改动：3.5 的 web 部分。
- 测试：5.1 中的 web 测试。
- 退出条件：web 测试通过；记录构建前后的结果。

#### 任务 B6：文档

- 文件：`docs/architecture/overview.md`、`AGENTS.md`、本计划及其中文阅读版。
- 改动：overview 写明有类型的 payload、解析发生的位置以及 web 包中的 zod；AGENTS.md 去掉指向 PR B 的说明；删除本计划。
- 测试：`check-doc-translations`。
- 退出条件：6.4 的门禁通过。

### 6.4 验证记录

| 批次 | 命令或证据 | 预期结果 |
| --- | --- | --- |
| A、B | `node scripts/format.mjs --check`、`node scripts/lint-scripts.mjs` | 退出码 0 |
| A、B | `rush lint`、`rush typecheck`、`rush test`、`rush build` | 退出码 0 |
| A、B | `node scripts/check-layers.mjs`、`node scripts/check-browser-bundle.mjs` | 退出码 0 |
| A、B | `node scripts/check-conventions.mjs`、`node scripts/check-doc-translations.mjs` | 退出码 0 |
| A、B | `node scripts/release-intent.mjs check --base "$(git merge-base HEAD origin/main)"`、`rush change --verify` | 退出码 0 |
| A、B | `gh repo-checks repository` | 退出码 0 |
| A、B | 使用 `AGENT_TRACE_E2E_CHANNEL=chrome` 的 `test:smoke`、`test:e2e` | 退出码 0 |
| A | 用旧的 `list-sessions.ts` 和 `report.ts` 运行 `handler-input.test.ts` | `list-sessions` 和 `export-report` 用例通过 |
| A | web 构建产物 | 与 `main` 逐字节相同 |
| B | 差分脚本、重跑 payload 普查、web 构建结果 | 没有差异；普查 0 失败；记录前后结果 |

### 6.5 分批回滚

每个 PR 可以单独回滚。在 PR B 合入后回滚 PR A，也会回滚 `fingerprint` 和 RPC schema，PR B 不依赖它们。

## 7. 风险、待定问题与后续工作

| 事项 | 类型 | 影响 | 负责人 | 下一步或期限 |
| --- | --- | --- | --- | --- |
| web gzip +9.5 KB（+10%），没有预算 | 风险 | 包体积 | 负责人 | PR B 记录前后结果 |
| 测试改动：约 17 个测试文件用任意 payload 构造 `TraceEvent` 字面量 | 风险 | PR B 体量；可能暴露从未符合 kit 形状的 fixture | PR B | 构造函数改用有类型的事件形状 |
| kit 以后修改某个已声明 payload 字段的类型 | 风险 | 规范文件不再通过 `isTrace`，交给 kit | PR B | 升级 kit 时编译期检查先失败 |
| `typescript/no-unsafe-type-assertion` 保持关闭 | 后续工作 | 未知数据以外的类型断言（DOM、库类型、测试替身）不受 lint 检查 | 未确认 | PR B 之后重新评估 |

## 8. 附录 A：清单

类别：**V** 违规，**R** 将变为有类型的 payload 读取，**E** 允许的例外（该处注释写明类别），**K** 保留，不在规则范围内（给出原因），**T** 测试代码。位置用文件和符号指明。

| 位置 | 现状 | 类别 | 改动 | PR |
|---|---|---|---|---|
| kernel `jsonl.ts`、`index.ts` | `asRecord`（lodash `isPlainObject` 加类型断言）、`asString`、`asNumber` | V | 删除；kernel 去掉 lodash-es | B |
| kernel `fold.ts` | `asNumber(asRecord(usage)?.[f])`、`durationMs`、`isError === true` | R | 收窄 `kind === 'request' / 'system' / 'tool_result'` | B |
| kernel `lanes.ts` | 宽松 payload 上的 `isPrompt` 标志；通过 helper 读取 `requestUsage` | R | 有类型的标志；`event.payload.usage?.inputTokens` | B |
| kernel `project-timeline.ts` | 用 helper 读取 model、durationMs、callId、name、trigger、pre/postTokens | R | 收窄后读取 | B |
| kernel `project-turns.ts` | `asNumber` durationMs | R | 收窄后读取 | B |
| kernel `reconstruct.ts` | `asString` summaryEventId、`compactSummary === true`、`asNumber` postTokens | R | `compactionBefore` 返回 `EventOf<'compaction'>` | B |
| kernel `prompt-snapshot.ts` | `payload as unknown as PromptSnapshotPayload` | V | `kind === 'system' && payload.type === 'prompt_snapshot'`，不做类型断言 | B |
| kernel `prompt-snapshot.ts`、`view.ts` 快照引用 | 对由该类型断言定类型的字段做 `typeof` / `isArray` | R | 对有类型字段做 `!== undefined` | B |
| kernel `view.ts` `Capper.value` | lodash `isObjectLike` 加 `as Record<string, unknown>` | V | es-toolkit `isPlainObject` | B |
| kernel `view.ts` `toView` | Capper 输出被断言为 payload 和 `Trace['session']` | V | 草稿类型为 `unknown`；对最终视图执行一次 `isTrace` | B |
| rpc `functions/list-sessions.ts` `checkQuery` | `typeof` object、`as Record`、`typeof` 级联 | V | `zod/mini` schema，消息不变 | A，已完成 |
| rpc `functions/report.ts` `checkInput` | `as Record`、`typeof` | V | `zod/mini` schema；仍忽略未知 locale | A，已完成 |
| rpc `functions/trace-view.ts` handler | `{ ref }`、`{ ref, id }`、`{ ref?, eventId }` 不经检查 | V | 在 handler 中用 `zod/mini` 解析 | A，已完成 |
| rpc `source-check.ts` `fingerprint` | `typeof` object、`as Record`、`typeof` 级联 | V | `isPlainObject` 和 `isPrimitive`，再做已知联合类型的 `typeof`（E） | A，已完成 |
| rpc `source-check.ts` `recordAt`、cli `session.ts` | `JSON.parse(…) as unknown` / `: unknown` | K | 放宽为 `unknown`，之后再解析 | – |
| runtime-node `session-index-schema.ts`、`session-index.ts` `isBusy` | `(error as { errcode?: unknown })` 加 `typeof` | V | 通过 `z.object({ errcode: z.number() })` 实现的 `sqliteErrcode()` | A，已完成 |
| runtime-node `session-index-schema.ts` `rebuildUnderLock`、cli `report.ts` `reserveDir` | `(error as { code?: unknown }).code !== 'EEXIST'` | V | `z.object({ code: z.literal('EEXIST') })` | A，已完成 |
| runtime-node `session-index-schema.ts` `readVersion`、`isEmpty`；`session-index.ts` 行读取 | 行类型断言、`readNumber(unknown)`、`String()` / `Number()` | V | 每个 SELECT 一个行 schema（D7） | A，已完成 |
| runtime-node `session-index.ts` `summaryOf` | 对 `context_shape` 做 `typeof` 加 `JSON.parse` 加 `every(typeof)` | V | `try JSON.parse` 加 `z.array(z.number())` | A，已完成 |
| runtime-node `session-index.ts` `casefold` 函数 | `typeof value === 'string'` | E | `SQLOutputValue` 是已知联合类型 | – |
| runtime-node `suppress-sqlite-warning.ts` | 对 `unknown` 参数做 `typeof` 级联和类型断言；`bind(...) as` | V | 参数类型按 `emitWarning` 的重载定义，做已知联合类型收窄 | A，已完成 |
| cli `report-site.ts` `bakedReport` | dump 清单和记录：`JSON.parse(...) as {...}` | V | `zod/mini` schema；`output` 保持 `unknown` | A，已完成 |
| cli `terminal.ts` `wrap` | 对 `unknown[]` 剩余参数做 `typeof item === 'function'` 加类型断言；`rest as []` | V | 剩余参数类型按 `Writable.write` 的重载定义；已知联合类型收窄 | A，已完成 |
| cli `scripts/third-party-notices.ts` `readManifest` | 把 `JSON.parse` 的结果当作有类型的清单返回 | V | `z.object` 清单 schema | A，已完成 |
| cli `transcript-trace.ts` | `events.map(e => ({ ...e }))`：宽松的 payload 进入 `Trace` | – | kit 0.14.0 的事件原样赋值（D4b、D10） | B |
| web `lib/event-text.ts` `toolTarget` | `asRecord(args)` 加 `typeof` 级联 | V | 显示用 schema（3.5） | B |
| web `lib/event-text.ts` 行文本、`numberField` | `$truncated` isArray，用 helper 读取 name、model、finishReason、text、type | R | 按 kind 的 `switch`；删除 `numberField` | B |
| web `lib/event-text.ts`、`tab-text.ts`、`event-row.tsx` | 读取 `tool_result.text`、`compaction.summary`、`tool_result.durationMs` | R | 删除：没有生产方写入它们 | B |
| web `lib/ledger-model.ts`、`inspector.tsx`、`tab-text.ts`、`turn-header.tsx`、`compaction-row.tsx`、`tool-status.tsx` | `asString` callId / finishReason，`typeof` text / summaryEventId，`numberField` | R | 收窄后读取 | B |
| web `lib/error-message.ts` | `typeof error === 'object' && 'message' in error` | V | 通过 `z.object({ message: z.string() })` 实现的 `messageOf` | B |
| web `inspector.tsx` 错误读取 | `(x.error as Error \| undefined)?.message` | V | `messageOf(x.error)` | B |
| web `shell/report.ts` | `JSON.parse(text) as ReportTrace` | V | `isReportTrace` schema 守卫 | B |
| web `workspace/load-session.ts` | 返回 `any` 的 `call` 被断言为 `LoadClient['call']` | V | 带三个有类型方法的接缝 | B |
| web `lib/event-text.ts`、`lib/preview.ts`；kernel `view.ts` | 通用 JSON 序列化中的 `typeof value === 'string'` | K | 内置的原始类型判断，不是形状守卫 | – |
| `session-ref.ts`、cli `trace-store.ts`、rpc `trace-store.ts`、`catalog.ts` | 对 `string \| SessionRef`、`string \| Uint8Array`、结果联合类型做 `typeof` / `in` | E | 已知联合类型收窄 | – |
| `instanceof Error`、`SyntaxError`、`LayoutMismatch`、`LoadCancelledError` | 名义类检查 | K | 不是形状守卫 | – |
| web `shell/client.ts`、`i18n/locale.ts` | `as ScopedClient`、`params as Record<string, string>` | K | 对已知类型做库类型适配 | – |
| `typeof document`、`typeof AGENT_TRACE_BUNDLE` | 环境和构建常量 | K | 不是数据 | – |
| schema `types.ts`、`index.ts` | 宽松的 `payload`、`usage: z.unknown()`、“trace 不会因 payload 内容被拒绝” | – | 3.5；重写注释；`isTrace` 仍是 schema 守卫 | B |
| rpc `handler-input.test.ts` `wire` | `setup as (context: unknown) => …` | T | 用 `z.function` schema 给 setup 及其 handler 赋予线上类型（任意输入、任意结果），不做类型断言 | A，已完成 |
| kernel、cli、web、rpc `testing/` 中的测试；e2e `harness.ts`、`scale.e2e.ts`、`tarball.ts` | 测试代码中的类型断言 | T | 在 PR B 改动的文件中修复 | B / – |
| 根目录 `scripts/*.mjs` | 读取 `JSON.parse` 输出的字段 | K | 根目录下无依赖的 JS；输入归仓库所有 | – |

## 9. 附录 B：测量数据

payload 普查（草稿 schema = 3.5），在 `3f100ad` 上：通过 `loadSession` 加载 282 个会话（全部 fixture、本机每个 Claude Code 和 Grok 会话、最大的 6 个 Codex 会话以及其余每第 25 个），382,476 个事件，payload schema 失败 0 次。它在 `system` 上发现 9 个未声明的键，在 `hook` 上发现 3 个。规范生成器的输出只在没有 `type` 的 `hook` 上失败。

整个事件的区分联合守卫的开销，在 `3f100ad` 上（现在只有规范文件、报告 JSON 和视图需要）：

| 会话 | 事件数 | 加载 | 事件守卫 | fitView（截断长度） | 视图守卫（一次） |
|---|---|---|---|---|---|
| Claude Code 81.6 MB | 11,041 | 288 ms | 24 ms | 49 ms (4096) | 28 ms |
| Claude Code 63.8 MB | 81,115 | 1,843 ms | 170 ms | 3,528 ms（256，44.1 MB，超出预算） | 189 ms |
| Codex 355 MB | 13,163 | 781 ms | 27 ms | 151 ms (2304) | 30 ms |
| Codex 341 MB | 5,173 | 537 ms | 10 ms | 24 ms (4096) | 11 ms |
| Codex 286 MB | 13,627 | 878 ms | 29 ms | 154 ms (2304) | 29 ms |

对 81k 条原始记录跑 `fingerprint`，在 `3f100ad` 上：手写 170 ms，es-toolkit 171 ms，每个值一个 zod 465 ms，zod record 加 catch 598 ms；所有写法的哈希相同。为 PR A 在一个 67.5 MB 的 Claude Code 会话上复测（33,945 条记录，重复到 81,000 次调用，9 次运行取中位数）：手写 108.3 ms，es-toolkit 109.9 ms，哈希相同。

5,000 行的会话索引，PR A 对比 `main`（11 次运行取中位数）：`rows()` 15.1 ms 对 10.6 ms；`putHeads` 写入 5,000 个未变化的头部 13.0 ms 对 11.3 ms。每行约 1 µs，每次启动一次。

`3f100ad` 上的 web 包（Vite）：286.8 KB 原始大小 / 94.6 KB gzip，没有 zod。为一个常量导入 schema 模块：22.9 KB / 6.3 KB gzip；trace 解析 36.2 KB / 8.8 KB；trace 加报告解析 39.3 KB / 9.5 KB。
