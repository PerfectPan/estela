> 中文阅读版。以英文原文 docs/plans/0006-server-composition.md 为准。

# Plan 0006: 把服务端组装移出 CLI 的命令

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-13
- Paired Spec: none（不改变行为的技术重构；issue #108）

本计划把 Estela 服务端的组装（通过 kit 读取会话、会话目录、TraceStore、报告写入器）从 CLI 的
`dev`、`build`、`mcp` 命令移到一个新 workspace 包里的单一工厂函数中，由它返回的 DevFrame
definition 在 `setup` 里构建并绑定这些服务。CLI 保留命令行、终端输出、退出码、失败映射和打开浏览器。

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Verification
5. Execution plan
6. Risks, open questions, and follow-up

## 1. 背景与目标

### 1.1 现状与约束

- `apps/cli/src/entry/commands/dev.ts` 创建 Node platform、`SessionCatalog` 和 TraceStore，
  然后在加载启动会话、建索引、执行 `--pick`、调用 `createDevServer` 之前，调用
  `@rivus/estela-rpc` 的 `bindTraceStore`、`bindSessionService`、`bindReportExporter`。
  `mcp.ts` 和 `build.ts` 各自创建并绑定自己的 TraceStore。
- DevFrame definition（`apps/cli/src/server/devframe.ts`）是模块级常量。它的 `setup` 注册 RPC
  函数和会话信号，不构建任何服务。报告写入器 import 这个常量用于 `createBuild`。
- DevFrame 的每个 adapter 都会运行 `setup`：`createDevServer` 和 `createMcpServer` 用 `dev`
  模式，`createBuild` 用 `build` 模式，`createEmbedded`（hub）用宿主的 context。hub 只运行
  `setup`，从不运行命令。
- `apps/cli` 是 `@rivus/agent-kit` 唯一的运行时导入方；`AGENTS.md`、根 `vite.config.ts` 的
  oxlint override 和 `scripts/check-layers.mjs` 都这样写。
- `@rivus/estela-rpc` 中的 RPC 绑定是模块状态：一个进程只服务一个服务端。

### 1.2 问题

第二个入口无法复用这套组装。DevFrame hub 或 harness 插件（计划中的 `apps/dsh-plugin`，运行在
DeepSeek Harness 内的 cordis 插件）没有命令行，只运行 `setup`，而现在的 `setup` 不绑定任何服务，
所以每个 RPC 都会以 "trace store is not bound" 失败。

### 1.3 目标与成功标准

- 一个工厂函数，接收 platform、启动会话、脱敏开关、带索引开关的会话目录和日志输出，返回在
  `setup` 中构建并绑定服务的 DevFrame definition，以及 CLI 需要的句柄。
- `dev`、`build`、`mcp` 调用该工厂；没有命令自己绑定 RPC 服务。
- 一个测试只用工厂和 DevFrame 的 dev adapter 启动服务端，不经过任何 CLI 代码，并通过
  WebSocket 上的 RPC 读取一个 fixture 会话。
- 行为不变：现有的单元测试、CLI 测试、smoke 和浏览器测试的断言全部照常通过。

### 1.4 非目标

- 不写插件代码、hub 代码，不新增 MCP 工具，不新增 RPC。
- 不改变 RPC 模块状态（仍然一个进程一个服务端）。
- `@rivus/estela` 的公开程序化导出推迟（决定 D3）。

## 2. 概要

### 2.1 设计原则

- definition 的 `setup` 是绑定服务的唯一位置，因此只运行 `setup` 的宿主得到与 CLI 相同的服务端。
- CLI 需要展示进度的步骤（启动会话加载、会话目录启动、picker 选中会话的加载）只运行一次；CLI
  可以在服务端监听之前先运行它们，`setup` 发现已完成就不再重复。
- 模块抛出自己的错误；只有 `apps/cli/src/entry/` 把它们映射为消息和退出码。
- 不引入第二个调用方用不到的抽象。

### 2.2 边界与职责

| Directory | Owns after this change |
|---|---|
| `packages/server`（`@rivus/estela-server`，私有，被打包） | `createEstelaServer` 和 DevFrame definition（`src/composition/`），通过 kit 读取会话（`src/sessions/`），会话目录（`src/catalog/`），基于 Node 读取的 TraceStore（`src/store/`），报告写入器（`src/report/`），S12 测试支持（`src/testsupport/`） |
| `apps/cli`（`@rivus/estela`） | 命令路由、终端输出、退出码、失败映射、打开浏览器（`src/entry/open-browser.ts`）、ATIF 和 OTLP 导出（`src/export/`）、交给工厂的包标识和 web 构建（`src/server.ts`）、`vp pack` 打包 |

### 2.3 主路径

```text
before: entry/commands/dev.ts
  -> platform, SessionCatalog, createTraceStore, bind* (rpc module state)
  -> load launch, index, pick
  -> createDevServer(devframe constant)   setup: register functions only

after:  entry/commands/dev.ts
  -> createEstelaServer(options)          (apps/cli/src/server.ts adds app identity)
  -> server.openLaunch(), catalog.start(progress), server.open(picked)   (shown in the terminal)
  -> createDevServer(server.definition)   setup: openLaunch (done), catalog.start (done),
                                                 bind* , resume summaries, session signal

hub:    createEmbedded(server.definition) setup: the same steps, run for the first time
```

### 2.4 设计决定

| ID | Decision | Alternatives and reason |
|---|---|---|
| D1 | 新建 workspace 包 `packages/server`（`@rivus/estela-server`）。 | 放在 `apps/cli` 内部的程序化模块能让组装靠近命令行，但将来的 `apps/dsh-plugin` 就要依赖 CLI 包及其终端代码。包按职责（服务端）命名，不重复上级目录 `packages/`。其中 store 的目录叫 `store/` 而不是 `server/`，避免目录与包名重复。 |
| D2 | `setup` 通过幂等的句柄方法运行各步骤（`openLaunch` 缓存其 promise；`catalog.start` 本来就是幂等的）并绑定服务；CLI 先调用同样的方法。 | 把所有服务都放到 `setup` 内构建，会让启动会话加载、索引进度和 picker 挪到服务端监听之后，从而改变终端输出和失败顺序。不需要在 options 中传入进度回调：CLI 用自己的回调启动会话目录，第一次 `start` 调用的回调生效。 |
| D3 | 推迟 `@rivus/estela` 的 `exports` 条目（tarball 中暂不包含 `@rivus/estela/server`）。`apps/cli/src/server.ts` 就是这个导出将来要暴露的函数。 | 实测：为 `src/server.ts` 增加带 `dts: { resolve: true }` 的 `vp pack` entry 会失败。TypeScript 7（`tsgo`）不为经 pnpm 符号链接到达的 workspace 源码生成声明（`tsgo did not generate dts file for packages/server/src/index.ts`，设置 `rootDir` 和 `paths` 后依然如此），而 CLI 整体的 `tsconfig` 会在 `entry/routes.ts` 上失败（TS2883，router 的推断类型）。声明还必须内联 `@rivus/agent-kit` 的类型，而它是使用方不会安装的 devDependency。没有类型的 JavaScript 导出不是可用的 API，公开 API 又是 semver 承诺；由第一个使用方（`apps/dsh-plugin`）来定。 |
| D4 | 运行时 kit 导入：`packages/server` 通过 kit 读取会话；`apps/cli` 只导入 `@rivus/agent-kit/redact`（终端行、导出文件）和 `@rivus/agent-kit/node`（导出命令的 platform）。 | 把 `export/` 移进服务端包能让 `apps/cli` 在运行时不依赖 kit，但会把一个命令的写入器放进服务端。oxlint override 用带否定的 group pattern 约束 CLI 允许的这两个入口。 |
| D5 | 会话目录的摘要在 `setup` 末尾恢复，而不是在 `createDevServer` 的 `onReady` 中。 | hub 没有给调用方的 `onReady`。`createDevServer` 先监听再运行 `setup`，所以摘要仍在服务端监听之后开始；它们在 MCP 路由挂载和 Ready 行打印之前开始，比原来早几毫秒。摘要是后台工作，不产生终端输出。 |
| D6 | `build` 不再把 TraceStore 绑定到 RPC 模块状态。 | `build` 只在 `build` 模式下运行 DevFrame，那里只烘焙 `report-trace`；报告直接从 store 读取（`reportOf`）。这个绑定没有读者。 |

## 3. 详细设计

### 3.1 接口

```ts
// packages/server/src/composition/definition.ts
export const BASE_PATH = '/__estela/'
export interface EstelaApp {
  packageName: string
  version: string
  homepage: string
  description: string
  clientAssets: string // the built SPA directory, absolute
}

// packages/server/src/composition/estela-server.ts
export interface EstelaServerOptions {
  app: EstelaApp
  platform?: ShellPlatform // defaults to createNodePlatform()
  catalog: { index: boolean } | undefined // present on the dev server
  launch: SessionTarget | undefined
  redacts: boolean
  log?: (line: string) => void
}
export interface OpenedSession { traceId: string; trace: Trace }
export interface EstelaServer {
  definition: DevframeDefinition
  catalog: SessionCatalog | undefined
  store: TraceStore
  openLaunch: () => Promise<OpenedSession | undefined>
  open: (traceId: string) => Promise<OpenedSession>
  close: () => void
}
export function createEstelaServer(options: EstelaServerOptions): EstelaServer

// apps/cli/src/server.ts
export function createEstelaServer(options: Omit<EstelaServerOptions, 'app'>): EstelaServer
```

`packages/server/src/index.ts` 还导出 CLI 从被移动模块中用到的内容：`reportOf`、
`writeReport(definition, outDir, report)`、`loadSession`、`errorMessage`、`parseSessionTarget`、
`sessionTargetLabel`，以及类型 `AgentProgress`、`SessionCatalog`、`ShellPlatform`。

### 3.2 setup 与生命周期

- `dev` 模式：注册 `serverFunctions`；`await openLaunch()`；`bindTraceStore`；有会话目录时，
  `await catalog.start()`、`bindSessionService`、`bindReportExporter`（用这个 definition 写报告）、
  `catalog.resumeSummaries()`；然后与原来一样设置 `estela:sessions` 共享状态和 `bindSessionPublisher`。
- `build` 模式：与原来一样，只注册 `serverFunctions` 和 `reportFunctions`。
- 启动会话的 key：有会话目录时为 `catalog.openPath(target, trace)`（列表行的 trace id）；没有时为
  `path#id` 标签，与原来一样。
- `close()` 刷新并关闭会话索引；与原来一样，CLI 目前不调用它。

### 3.3 失败

- `openLaunch` 和 `open` 抛出加载本身的错误；对会话目录无法解析的 id，`open` 抛出
  `no session has the trace id …`。CLI 把它们包装成自己的 `CliError` 类型 `session`
  （`load`、`build`）和 `index`，文案和退出码不变。
- 启动会话加载失败后 `openLaunch` 保持 rejected；`setup` 向宿主重新抛出同一个错误。

### 3.4 兼容性

- 命令行、终端输出、URL、trace id、RPC 名称和结构、索引文件、报告输出以及 tarball 文件列表不变。
- 唯一的时序差异见 D5。
- 文件移动：`apps/cli/src/{sessions,catalog,report,testsupport}/` → `packages/server/src/…`；
  `apps/cli/src/server/trace-store.ts` → `packages/server/src/store/trace-store.ts`；
  `apps/cli/src/server/devframe.ts` → `packages/server/src/composition/definition.ts`；
  `apps/cli/src/server/open-browser.ts` → `apps/cli/src/entry/open-browser.ts`；五个集成测试从
  `apps/cli/test/` 移到 `packages/server/test/`。e2e harness 和 `docs/development/setup.md`
  按新路径运行 `large-session.ts`。

### 3.5 安全与隐私

脱敏不变：store 按 `redacts` 脱敏，会话目录按 `ESTELA_REDACT`，报告始终脱敏。工厂测试绑定
`127.0.0.1` 并关闭鉴权。

## 4. 验证

- `packages/server/test/estela-server.test.ts`：`createEstelaServer` 加 `createDevServer`，端口 0，
  空的临时 home，以 Claude Code `plain` conformance fixture 作为启动会话；WebSocket RPC 客户端对
  `current` 调用 `load-trace`（命中缓存）、`get-trace-view`、`get-event`，对列表行 trace id 调用
  `get-trace-view`，并调用 `list-sessions`。
- 被移动的单元和集成测试在 `packages/server` 中运行；CLI 的测试、`test:smoke` 和 `test:e2e`
  在打包后的 tarball 上端到端覆盖各命令。

## 5. 执行计划

### 5.1 前置条件

`main` 位于 `055fccf` 或之后；Node `^26.13.1`。

### 5.2 完成条件

- 5.4 中的每个检查都通过。
- `apps/cli/src/entry/commands/` 下没有模块调用 `@rivus/estela-rpc` 的 `bind*` 函数。
- `AGENTS.md`、`CONTRIBUTING.md`、`docs/architecture/overview.md`、oxlint override 和
  `scripts/check-layers.mjs` 写明 D4 的运行时 kit 规则。

### 5.3 执行顺序

#### Task 1: 创建包并移动模块

- Files: `packages/server/{package.json,tsconfig.json,vite.config.ts,src/index.ts}`，以及 3.4 中的移动。
- Change: `git mv`；修改 import 路径；报告写入器改为以参数接收 definition。
- Tests: 被移动的测试，断言不变。
- Exit condition: `pnpm typecheck` 和 `pnpm test` 通过。

#### Task 2: 工厂与命令

- Files: `packages/server/src/composition/*.ts`、`apps/cli/src/server.ts`、
  `apps/cli/src/entry/commands/{dev,build,mcp,export}.ts`。
- Change: 3.1 和 3.2；各命令调用工厂。
- Tests: `packages/server/test/estela-server.test.ts`。
- Exit condition: 工厂测试、`test:smoke` 和 `test:e2e` 通过。

#### Task 3: 规则、文档、发布意图

- Files: `AGENTS.md`、`CONTRIBUTING.md`、`docs/architecture/overview.md`、根 `vite.config.ts`、
  `scripts/check-layers.mjs`、本计划及其中文版、`docs/plans/README.md`、
  `.changeset/server-composition.md`（`none`：内部改动，没有公开导出）。
- Exit condition: `check-doc-translations`、`check-conventions`、`check-release-plan`、
  `check-layers` 和 `pnpm lint` 通过。

### 5.4 验证记录

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| all | `node scripts/check-doc-translations.mjs`、`node scripts/check-conventions.mjs`、`node scripts/check-release-plan.mjs` | ok |
| all | `pnpm install`、`node scripts/format.mjs --check`、`node scripts/lint-scripts.mjs`、`pnpm lint`、`pnpm typecheck` | 无错误 |
| all | `pnpm build`，然后 `pnpm test` | 全部通过 |
| all | `node scripts/check-layers.mjs`、`node scripts/check-browser-bundle.mjs` | ok |
| all | `cd apps/e2e && pnpm run test:smoke`、`pnpm run test:e2e` | 全部通过 |

### 5.5 分批回滚

一个 PR；回滚即 revert 它。不涉及持久化数据、索引布局或已发布接口的变化。

## 6. 风险、未决问题与后续

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| RPC 绑定是模块状态 | risk | 同一进程中的两个 Estela 服务端（一个 hub 托管两个）会共享一份绑定 | unconfirmed | 有宿主需要两个实例时再处理 |
| 公开的 `@rivus/estela/server` 导出（D3） | follow-up | `apps/dsh-plugin` 暂时无法从已发布的包导入工厂 | unconfirmed | 在插件的第一个 PR 中解决声明构建（isolated declarations，或基于窄接口手工维护的 `.d.ts`） |
| 摘要启动移入 `setup`（D5） | risk | `dev` 上摘要提前几毫秒开始 | unconfirmed | 除非启动变慢，否则不处理 |
| Plan 0002 和 0003 写的是旧的 `apps/cli/src` 路径 | follow-up | 仅历史文本 | unconfirmed | 在这些计划退役时更新 |
