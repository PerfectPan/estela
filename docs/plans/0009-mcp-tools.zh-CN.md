> 中文阅读版。以英文原文 docs/plans/0009-mcp-tools.md 为准。

# Plan 0009: 查看早先会话的 MCP 工具

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-13
- Paired Spec: [`docs/specs/0009-mcp-tools.zh-CN.md`](../specs/0009-mcp-tools.zh-CN.md)

本计划在 `packages/server` 中实现 Spec 0009 的 agent 工具，在定义的 `setup` 中注册它们，使不带路径的 `estela mcp`
提供会话目录，并把 dev server 的 HTTP MCP 路由默认关闭。它叠在 plan 0006（`createEstelaServer`，PR #115）之上。

## Contents

1. 背景与目标
2. 概要
3. 详细设计
4. 验证
5. 执行计划
6. 风险、未决问题与后续

## 1. 背景与目标

### 1.1 现状与约束

- DevFrame 1.1.0（本 worktree 安装的 `devframe`、`@devframes/agentic`）从带 `agent` 字段的 RPC 函数派生 MCP 工具。
  其输入 schema 来自 RPC 的 `args`（按位置的 Standard Schema）；`args` 会公布 `arg0`（devframe#420），所以 Estela 的
  handler 自行解析输入，`estela_reconstruct` 以 `{ type: "object", properties: {} }` 列出。RPC 的 `agent` 选项没有
  `inputSchema`。
- 通过 `ctx.agent.registerTool` 注册的工具可以带原始 `inputSchema`；MCP adapter 的 `projectTool` 先用它，再考虑计算
  （`tool.inputSchema ?? computeInputSchema(tool, ctx)`）。id 由 `toAgentToolName` 映射为线上名称
  （`estela:reconstruct` → `estela_reconstruct`）。存在同 id 且带 `agent` 的 RPC 时，`registerTool` 抛出 `DF0015`。
- adapter 用 `stringifyForMcp(result)` 回复：字符串原样通过，其他值为 `JSON.stringify(value, …, 2)`。只有带输出 schema
  时才发送 `structuredContent`。
- `TraceStore.reconstruct` 返回 kernel 结果时不经过 `present`，与 `view`、`event` 不同，所以 MCP 结果没有脱敏。
  事件 id 来自日志（Claude Code 的 `uuid`）。
- `createDevServer` 在 `mcp: undefined` 时，一旦 agent 接口非空就以 `authorization: false` 挂载 `/__estela/__mcp`：
  只有 origin 与 loopback 对端检查，没有保护 WebSocket 的一次性验证码。
- 不带路径的 `estela mcp` 加载内置演示 trace；它以 `catalog: undefined` 构建服务端。
- 会话目录（`SessionCatalog.listSessions`）提供带摘要计数的行、查询的 `matches`（索引中的 FTS5，或内存中相同的子串规则），
  以及让某些行先计算摘要的 `first`。

### 1.2 问题

agent 无法通过 MCP 访问早先的会话，唯一工具的 schema 为空，结果没有脱敏，来自日志的 id 原样通过。增加读取所有会话的工具，
会把未经认证的 HTTP 路由从对 `current` 的一次 reconstruct 扩大到每个会话的内容。

### 1.3 目标与成功标准

- 七个工具，名称、schema、结果、上限和错误符合 Spec 0009；`tools/list` 对每个工具都显示命名属性。
- 不带路径的 `estela mcp` 提供会话目录；带路径时提供基于 `current` 的五个会话工具。
- 每个工具结果和错误都在一处脱敏，不论 `ESTELA_REDACT` 的值。
- S17 与 S18 在已安装的 tarball 上通过。

### 1.4 非目标

- 不为浏览器新增 RPC，不改动浏览器的 RPC，不做写入工具，不做 MCP resources。
- 除默认关闭外，不为 HTTP 路由增加授权（issue #94）。
- 不改动 `@rivus/agent-kit`；不把 skill 放进 npm tarball。

## 2. 概要

### 2.1 设计原则

- 每个工具一个解析 schema，既做输入检查，也是公布的 JSON Schema。
- 工具是对现有读取（目录行、TraceStore 的 trace、kernel 投影）的呈现；不增加索引内容，不做估算。
- 脱敏和上限在工具边界、所有服务之后施加，任何服务设置都无法关闭它们。

### 2.2 边界与职责

| Directory | Owns after this change |
|---|---|
| `packages/server/src/agent-tools/` | 工具输入（`inputs.ts`）、上限（`bounds.ts`）、id 别名（`trace-ids.ts`）、会话列表（`session-list.ts`）、摘要、轮次与请求（`trace-reads.ts`）、事件与 reconstruct 结果（`event-read.ts`）、带脱敏的注册（`register.ts`） |
| `packages/server/src/composition/` | 在 `dev` 模式的 `setup` 末尾调用 `registerAgentTools(ctx.agent, …)` |
| `packages/rpc` | `TraceStore.withTrace`（对已加载 trace 的读取）以及经过 present 的 `reconstruct`；`reconstruct` RPC 去掉 `agent` 字段 |
| `packages/kernel` | `capStrings`：视图对单个值的字符串截断 |
| `apps/cli` | 不带路径的 `mcp` 构建会话目录；`--mcp` 默认关闭；帮助文本 |
| `skills/estela/` | agent skill，保存在仓库中 |

### 2.3 主路径

```text
MCP client --stdio--> createMcpServer(definition)            (estela mcp)
                      setup: openLaunch | catalog.start, bind services,
                             registerAgentTools(ctx.agent, { store, catalog, home })
tools/list  -> ctx.agent.list() -> inputSchema from inputs.ts (z.toJSONSchema)
tools/call  -> handler: parseToolInput -> run -> redact -> JSON.stringify (compact)
   list/search  -> catalog.listSessions({ query?, first? }) -> filter -> pageWithin
   summary/turns/requests -> store.withTrace(traceId, trace -> kernel projections)
   get_event    -> store.withTrace (resolve id) -> store.event -> capStrings, fit
   reconstruct  -> store.withTrace(trace -> kernel reconstruct) -> last ids, fit
```

### 2.4 设计决定

| ID | Decision | Alternatives and reason |
|---|---|---|
| D1 | 用 `ctx.agent.registerTool` 注册工具，原始 `inputSchema` 由解析输入的 `zod/mini` schema 经 `z.toJSONSchema(schema, { io: 'input' })` 生成。 | RPC `args` 会公布 `arg0`（devframe#420）。与解析 schema 并存的手写 JSON Schema 可能偏离。`args` 中的 Standard Schema 同样按位置。 |
| D2 | 工具 id 为 `estela:<snake_name>`，线上名称为 `estela_<snake_name>`，因此 `estela_reconstruct` 保持名称。`reconstruct` RPC 为 DevFrame 客户端保留，但去掉 `agent`。 | RPC 保留 `agent` 会与注册的 id 冲突（`DF0015`）。kebab 名称会在线上名称中带 `-`，与现有工具和常见 MCP 风格不一致。 |
| D3 | 工具放在 `packages/server`，不放在 `packages/rpc`。 | 它们在运行时用 kit 脱敏并读取会话目录；`packages/rpc` 只能使用 kit 的类型，且必须能打包进浏览器。 |
| D4 | 在 `register.ts` 中、所有服务之后，用 kit 的 `redact`/`redactText` 和平台的 home 对每个结果和错误消息脱敏；每个记录的字符串都先脱敏再截断（`bounds.ts` 中的 `shown`），并要求会话目录在缩短提示词之前脱敏（`listSessions(query, redact)`）。kit 在脱敏之前截断标题（80）和第一条提示词（500），所以对这些字段由 `trimCutHome` 把结尾不完整的 home 路径替换为 `~`；kit 改为先脱敏再截断后即可去掉。 | 依赖 store 的 `present` 和目录对 `ESTELA_REDACT` 的检查，会让 `ESTELA_REDACT=0` 时 dev server 的路由不脱敏。脱敏是幂等的，store 已脱敏的结果不变。 |
| D5 | 不安全的事件与 lane id 显示为 `@e<seq>` / `@l<n>` 并可作为输入；内容保持记录原样。 | 截断或脱敏 id 会让下一次调用失败。对 id 做哈希会让所有 id 都不透明，agent 也失去在内容中可能看到的记录 id。安全字符集不含 `@`，别名不会与记录的 id 冲突。 |
| D6 | 结果以紧凑 JSON 文本返回。 | adapter 会以两个空格缩进格式化对象，比上限测量的大约多三分之一；字符串原样通过。不提供输出 schema，因此没有 `structuredContent`：在结果形状有用户之前，输出 schema 是又一个需要固定的接口。 |
| D7 | 每个结果上限 40,000 个字符；列表页在达到上限时提前结束并给出 `nextOffset`；用 offset，不用 cursor。 | Claude Code 在工具输出超过 10,000 token 时警告。不透明 cursor 增加状态；列表按活动排序，agent 需要最新视图时从 offset 0 重读。 |
| D8 | `estela_get_event` 在脱敏之后用 kernel 的视图截断器（`capStrings`）截断字符串，并以 0.75 的步长把上限降到 256，然后省略 `original`，再省略 `payload`。 | 先截断再脱敏可能把 home 路径截在脱敏模式之前。与视图 `$truncated` 相同的路径格式保持一种约定。 |
| D9 | `estela_reconstruct` 每个列表保留最后 100 个 id 并给出总数。 | 最后的 id 离事件最近；轮次与请求工具可以访问更早的事件。分页的 reconstruct 为少见需求增加输入。 |
| D10 | 标志过滤先让会话目录优先计算未检查的会话（`first`），最多等待 5 秒；其余计入 `unsummarized`。 | 不等待时，冷索引上第一次 `estela_mcp` 在摘要计算期间回答“没有会话”（手动遍历中观察到）。更长或无上限的等待会阻塞客户端。 |
| D11 | 没有路径也没有 `ESTELA_PATH` 时，`estela mcp` 提供会话目录；带路径时保持单会话服务端，不注册列表工具。 | 同时提供目录和路径会改变现有用户的 `current` 语义；演示 trace 对 agent 没有用处。 |
| D12 | dev server 只在给出 `--mcp` 时挂载 HTTP MCP 路由，帮助写明一次性验证码不保护它。 | 这些工具暴露每个会话的内容；路由的 origin 与 loopback 检查挡不住本机的其他用户或进程。bearer token 是修复方案（#94），但需要把 token 交给客户端的方式。 |
| D13 | `estela mcp` 使用 `exposeSharedState: false`。 | DevFrame 的 `devframe_state_read` 工具会暴露浏览器的 `{ revision, pending }` 信号，对 agent 没有信息。 |
| D14 | skill 保存在仓库中（`skills/estela/SKILL.md`），README 说明安装方法。 | 发布它需要在打包时把它复制进 `apps/cli`，并修改 tarball 文件列表检查；该包尚未发布。 |

## 3. 详细设计

### 3.1 接口

```ts
// packages/server/src/agent-tools/register.ts
export interface AgentToolDeps {
  store: TraceStore
  catalog: SessionSource | undefined // { listSessions(query): Promise<ListSessionsResult> }
  home: string
}
export function registerAgentTools(host: Pick<DevframeAgentHost, 'registerTool'>, deps: AgentToolDeps): string[]

// packages/rpc/src/trace-store.ts
class TraceStore {
  withTrace<T>(traceId: string, read: (trace: Trace) => T): Promise<T> // own hold, errors scrubbed
  reconstruct(traceId: string, eventId: string, owner?: object): Promise<ReconstructResult> // now presented
}

// packages/kernel/src/view.ts
export function capStrings(value: unknown, max: number): { value: unknown; truncated: TruncatedPath[] }

// packages/server/src/composition/definition.ts
export function defineEstela(app: EstelaApp, services: (ctx: DevframeNodeContext) => Promise<void>): DevframeDefinition
```

### 3.2 setup 与生命周期

- `dev` 模式的 `setup`：按 plan 0006 执行，然后调用 `registerAgentTools(ctx.agent, { store, catalog, home: platform.home })`。
  没有会话目录时不注册列表与搜索工具。
- `estela mcp`：有目标时先 `openLaunch`（失败映射为 `session` 失败，退出码 1）；没有目标时先 `catalog.start()`
  （失败映射为 `index`），索引不可用时写一行 stderr。然后调用
  `createMcpServer(definition, { transport: 'stdio', exposeSharedState: false })`。
- `TraceIds`（别名映射）按已加载的 trace 对象缓存在 `WeakMap` 中，与 store 保留该 trace 的时间一样长。

### 3.3 失败

handler 抛出错误；DevFrame 的 adapter 把抛出转换为 `isError: true` 和 `Error invoking "<tool>": Error: <message>`。
输入错误是 `parseToolInput` 抛出的 `TypeError`；store 错误保留原消息（`unknown trace id: …`、加载错误），未知 trace id
会附加提示。每条消息在离开 handler 之前脱敏。

### 3.4 兼容性

见 Spec 的兼容性一节。`apps/cli/test/cli-smoke.test.ts` 与 S10 不需修改即可通过：路径形式、工具名，以及 `eventId`、
`visibleIds`、`unavailable`、`completeness` 字段保持不变。

### 3.5 安全与隐私

- 在工具边界脱敏（D4）；id 使用别名（D5）；描述把结果标为数据。
- HTTP 路由默认关闭（D12）。给出 `--mcp` 时，本机任何发送 loopback `Origin` 的进程都能访问它；issue #94 负责它的授权。
- 结果仍含会话文本和文件内容，与报告相同。

## 4. 验证

- `packages/server/src/agent-tools/` 中代码旁的单元测试：输入（schema 形状、错误）、上限（分页）、trace id（别名）、
  会话列表（过滤、标志、等待、截断）、事件读取（先脱敏后截断、降低上限、reconstruct 列表）。
  `packages/kernel/src/view.test.ts` 覆盖 `capStrings`；`packages/rpc/src/trace-store.test.ts` 覆盖 `withTrace`
  和经过 present 的 `reconstruct`。
- `packages/server/test/agent-tools.test.ts`：`createEstelaServer` 与 DevFrame 的 `createHostContext`、`setup`，然后在
  `ESTELA_REDACT=0` 的合成 home 上调用 `ctx.agent.list()` 与 `invoke`：schema、遍历、分页、恶意会话和错误。
- `apps/e2e/src/mcp.smoke.ts`：在已安装 tarball 上通过 stdio 运行 S17 与 S18。
- 对已构建 CLI 的手动 stdio 遍历，以及对 dev server 路由在有无 `--mcp` 时的手动检查。

## 5. 执行计划

### 5.1 前置条件

`refactor/server-composition`（PR #115）在 `16d7c9a` 或之后；Node `^26.13.1`；DevFrame 1.1.0。

### 5.2 完成条件

- 5.4 中的每个检查都通过。
- `estela mcp` 的 `tools/list` 显示七个带命名属性的工具；`estela mcp <path>` 显示五个。
- `ESTELA_REDACT=0` 时没有工具结果包含 home 目录（S18）。

### 5.3 执行顺序

#### Task 1: Store 与 kernel

- Files: `packages/rpc/src/trace-store.ts`, `packages/rpc/src/original-reload.ts`, `packages/rpc/src/functions/trace-view.ts`, `packages/kernel/src/view.ts`, `packages/kernel/src/index.ts`，以及它们的测试。
- Change: `withTrace`；`reconstruct` 经过 present；`withoutOriginals` 移到 `original-reload.ts`（store 文件保持在 500 行以内）；RPC 去掉 `agent`；`capStrings`。
- Exit condition: `packages/rpc` 与 `packages/kernel` 中的 `pnpm test` 通过。

#### Task 2: Agent 工具

- Files: `packages/server/src/agent-tools/*`, `packages/server/src/composition/{definition,estela-server}.ts`, `packages/server/test/agent-tools.test.ts`。
- Change: 3.1 与 3.2。
- Exit condition: 单元测试与集成测试通过。

#### Task 3: CLI

- Files: `apps/cli/src/entry/{app,routes}.ts`, `apps/cli/src/entry/commands/{mcp,dev}.ts`。
- Change: 不带路径的 `mcp`、`--mcp` 默认关闭、帮助文本。
- Exit condition: `apps/cli` 测试通过；手动遍历可用。

#### Task 4: Smoke、skill、文档、发布意图

- Files: `apps/e2e/src/mcp.smoke.ts`, `skills/estela/SKILL.md`, `scripts/check-conventions.mjs`（`SKILL.md` 是固定名称）, `CONTRIBUTING.md`, `AGENTS.md`, `README.md`, `README.zh-CN.md`, `apps/cli/README.md`, `docs/architecture/overview.md`, `docs/development/setup.md`，Spec 与 Plan 0009 及其中文版, `docs/specs/README.md`, `docs/plans/README.md`, `.changeset/mcp-tools.md`（`minor`）。
- Exit condition: 5.4 中的每个检查。

### 5.4 验证记录

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| all | `node scripts/check-doc-translations.mjs`, `node scripts/check-conventions.mjs`, `node scripts/check-release-plan.mjs` | ok |
| all | `pnpm install`, `node scripts/format.mjs --check`, `node scripts/lint-scripts.mjs`, `pnpm lint`, `pnpm typecheck` | 无错误 |
| all | `pnpm build`，然后 `pnpm test` | 全部通过 |
| all | `node scripts/check-layers.mjs`, `node scripts/check-browser-bundle.mjs` | ok |
| all | `cd apps/e2e && pnpm run test:smoke`, `pnpm run test:e2e` | 全部通过 |
| all | 针对 `apps/cli/bin.mjs mcp` 的 stdio 客户端遍历；有无 `--mcp` 时对 `/__estela/__mcp` 的 `curl` | 遍历返回结果；路由只在带 `--mcp` 时响应 |

### 5.5 分批回滚

一个 PR；回退它即可。会话索引布局和浏览器的 RPC 都没有改变。

## 6. 风险、未决问题与后续

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| 给出 `--mcp` 时 HTTP 路由没有授权 | risk | 本机其他进程可以通过该路由读取每个会话 | unconfirmed | Issue #94 |
| 结果形状尚无用户 | risk | 不合适的形状现在需要一个 minor 版本修改，1.0 之后需要 major 版本 | unconfirmed | 1.0 之前与首批 agent 用户一起审视这些形状 |
| TraceStore 保留 3 个 trace | risk | 遍历许多会话时会重新加载；大会话加载慢 | unconfirmed | agent 遍历许多会话时再评估 |
| `estela mcp --no-index` | follow-up | 无法在不用索引的情况下运行 stdio 会话目录 | unconfirmed | 有需求时增加该开关 |
| 事件列表工具、内容搜索、费用、上下文 diff 作为工具 | follow-up | 不在本次范围内 | unconfirmed | 分别建 issue |
| kit 在脱敏之前截断标题和第一条提示词 | risk | 浏览器的会话列表和 `--pick` 标签可能显示在 80 个字符处被截断的 home 路径开头；MCP 工具用 `trimCutHome` 绕过 | unconfirmed | 在 `@rivus/agent-kit` 中修复（先脱敏再截断），然后去掉 `trimCutHome` |
| 在 npm 包中发布 skill | follow-up | 用户从仓库复制它 | unconfirmed | 包发布时 |
