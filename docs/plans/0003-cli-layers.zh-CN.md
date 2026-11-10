> 中文阅读版。以英文原文 docs/plans/0003-cli-layers.md 为准。

# Plan 0003: 按职责分层 CLI，并用 @bomb.sh/router 路由命令

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-10
- Paired Spec: none（技术重构；命令行上的变化列在 3.6）

本计划把 `apps/cli/src` 按职责分组，并用 `@bomb.sh/router` 上的一张路由表取代 CLI 原来的两个参数
解析器：手写的 `argv.ts` 和 DevFrame 的 cac 适配器。终端输出继续使用 `@clack/prompts`。

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Verification
5. Execution plan
6. Risks, open questions, and follow-up

## 1. Background and goals

### 1.1 Current behavior and constraints

- `apps/cli/src` 目录下直接放着 21 个模块和 15 个测试。`main.ts`（233 行）解析参数、读取环境变量、
  选择输出模式、加载会话、组装服务器，并在每条失败路径上调用 `process.exit`。
- 参数要解析两遍。`argv.ts` 手动遍历 `process.argv`，取出 `--pick`、`--no-index`、`--out-dir`、
  `--out` 和会话路径，再把其余部分交给 `devframe/adapters/cac` 的 `createCac`，由 `main.ts` 最后执行。
- 本次修改前用 `node apps/cli/bin.mjs` 观察到：
  - `--version` 输出 `agent-trace/0.0.0`：适配器把版本写死为 `cli.version("0.0.0")`。
  - `--help` 只列出 `build` 和 `mcp`，用的是 DevFrame 的通用描述，没有 `export-atif` 和
    `export-otlp`；`export-atif --help` 输出的是顶层帮助；`build --help` 列出了 `build` 会忽略的
    `--pretty`，以及它不接受的 `--pick` 和 `--no-index`。
  - dev 命令上的未知选项要等会话加载完、所有 agent 根目录都建完索引后才检查，失败时打印 `CACError`
    堆栈。`build` 和导出命令直接忽略未知选项。
- DevFrame 导出了 `createDevServer` 和 `resolveDevServerPort`（`devframe/adapters/dev`）、`createBuild`
  （`devframe/adapters/build`）和 `createMcpServer`（`devframe/adapters/mcp`）。它的文档指明，基于其他
  框架构建的 CLI 以 `createDevServer` 为入口。`cac` 是 `devframe` 的可选 peer。
- `@clack/prompts` 已经负责所有终端输出；stdout 不是 TTY 或设置了 `NO_COLOR` 时输出纯文本行。

### 1.2 Problem

平铺的目录看不出数据流：命令层、会话目录、会话读取、服务器组装、报告写入之间没有边界，`main.ts`
还把它们和进程控制混在一起。两遍解析造成了上面的缺陷，每加一个命令都要同时改两个解析器。

### 1.3 Goals and success criteria

- `apps/cli/src` 按职责分组（2.2）。只有 `cli/` 解析命令行、写终端输出、设置退出码。
- 只解析一遍。路由表在加载会话或建立索引之前拒绝未知选项和多余的位置参数。
- `agent-trace --help` 列出所有命令，每个命令都有自己的 `--help`，`--version` 输出包的版本。
- 一张表把每种预期失败映射到它的消息、修复提示行和退出码，并由类型检查保证没有遗漏。
- 命令、选项、默认值、环境变量、退出码和纯文本输出行（`Ready:`、`Load:`、`Redact:`、`Write:`、
  `Wrote`）保持不变，3.6 列出的变化除外。

### 1.4 Non-goals

- 不改 kernel、schema、RPC、runtime-node 和 web 包，不改会话目录的行为，不改报告和导出文件的内容。
- 不新增命令、选项或 shell 补全。
- #81 提出的托管 dsh 插件不属于这个布局。kit 的 dsh provider 已经能读取 DeepSeek Harness 会话
  （#70），所以 CLI 里不放捕获格式，也不放安装器。

## 2. Outline

### 2.1 Design principles

- 入口层读取命令行和终端状态，再把下层模块需要的东西传给它们：会话目标、是否脱敏、一个 `log` 函数。
  下层模块抛出自己的错误，从不打印输出或退出进程。
- 移动代码而不是重写代码。除 `main.ts` 和 `argv.ts` 外，模块保留原有逻辑：`createTraceStore` 改为接收
  `log` 函数，`writeExport` 改为接收 `redacts` 参数，不再自己写 stderr、读环境变量；其余只改 import 和路径。

### 2.2 Boundaries and responsibilities

| Directory | Owns | Depends on |
| --- | --- | --- |
| `src/cli/` | 路由表（`routes.ts`）、分发（`app.ts`）、帮助与版本文本（`help.ts`）、失败表（`failure.ts`）、每个命令一个模块（`commands/`）、终端输出（`ui/`） | 下面所有目录 |
| `src/sessions/` | 通过 kit 加载一个会话目标、trace id 和目标标签、读取失败的措辞、`ShellPlatform` | 无 |
| `src/catalog/` | 会话目录：发现、行、摘要、摘要队列、索引缓存 | `sessions/` |
| `src/server/` | DevFrame 定义、TraceStore 组装、打开浏览器 | `sessions/`、`paths.ts` |
| `src/report/` | 生成报告并打包成可从 `file://` 打开的文件 | `server/` |
| `src/export/` | 写 ATIF 和 OTLP 文件 | 无 |
| `src/` | `main.ts`（进程入口）、`paths.ts`、`node-version.mjs`、`testsupport/` | `cli/` |

这一列只列 `apps/cli/src` 内的目录；包之间的依赖遵循 `AGENTS.md` 中 Layers 表的 `apps/cli` 一行。

测试放在被测模块旁边。启动 CLI 或子进程的测试，以及用一个模块的输出核对另一个模块输出的测试，放在
`apps/cli/test/`。

### 2.3 Main path

```text
bin.mjs → main() → runCli(argv)
  parse(routes, argv) ─ not ok ─→ usage failure → stderr, exit 1
    ├─ help    → helpText   → stdout, exit 0
    ├─ version → versionText → stdout, exit 0
    └─ execute → commandOf(intent) ─ usage failure → stderr, exit 1
                   ├─ /            runDev:    catalog, TraceStore, createDevServer (onReady: Ready line, browser)
                   ├─ /build       runBuild:  load once, reportOf, writeReport
                   ├─ /mcp         runMcp:    load once, seed the TraceStore, createMcpServer (stdio)
                   └─ /export-*    runExport: load once, writeExport
  CliError(failure) → failureReport → stderr or sayError → exit code
```

### 2.4 Design decisions

- **D1. 解析器：`@bomb.sh/router`。** `@bomb.sh/args`（0.3.1）只是一个参数解析器，没有命令、帮助和
  校验；它把 `--` 当成名为 `""` 的选项，并把每个以数字开头的位置参数转成数字（`2026-11-10.jsonl`
  会变成 `NaN`），会话路径因此需要再遍历一遍 argv，也就是本计划要去掉的两遍解析。不经 DevFrame 适配器
  直接用 cac，能修好版本和帮助文本，但解析器仍然没有类型化的路由和 schema 校验。`@bomb.sh/router`
  （0.8.0，MIT，只有一个纯类型依赖）把命令行匹配为类型化的意图（`help`、`version`、`execute`），用
  Standard Schema 校验每个值（仓库现有的 `zod/mini` schema 不用改就能用），拒绝任何路由都不接受的
  token，并把 `--` 之后的 token 作为 literal 返回。它和 `@clack/prompts` 一样打包进 `dist/cli.mjs`。
- **D2. `AGENT_TRACE_PATH` 仍由 CLI 自己读取，作为回退值。** 如果给 router 传入环境变量记录，它还会
  绑定 `PORT`、`HOST` 以及其他所有选项名；而 `--pick` 必须忽略这个变量。
- **D3. 帮助文本来自 router 的 `printHelp`，但用完整命令名。** 打印器只用路径给嵌套路由起标题
  （`build`），所以 `help.ts` 把路由改名为 `agent-trace build` 后再交给它。每个路由都带版本号，
  `--version` 输出 `agent-trace <version>`。
- **D4. 所有失败在一张表里。** `cli/failure.ts` 定义 `CliFailure` 联合类型和 `failureReport`，后者是一个
  每种 kind 都必须返回的 `switch`。命令抛出 `CliError`；`cli/` 以下没有代码退出进程。所有失败的退出码
  仍是 1。
- **D5. 先校验再输出。** `commandOf` 检查意图（命令名之前写了会话或选项、`--pick` 冲突、`--` 之后的
  token），然后返回要执行的命令，所以用法错误发生在输出过滤器和任何命令启动之前。

## 3. Detailed design

### 3.1 Route table

| Route | Argument | Options |
| --- | --- | --- |
| `/`（dev 服务器） | `[session]` | `--port <n>`、`--host <h>`（默认 `localhost`）、`--open`/`--no-open`、`--auth`/`--no-auth`、`--mcp`/`--no-mcp`、`--pick`、`--index`/`--no-index` |
| `/build` | `[session]` | `--out-dir <dir>`（默认 `dist-static`） |
| `/mcp` | `[session]` | 无 |
| `/export-atif`、`/export-otlp` | `[session]` | `--out <file>` |

- `session` 回退到 `AGENT_TRACE_PATH`（空值视为未设置）；`build`、`mcp` 和导出命令再回退到内置的
  演示 trace。`--` 之后的那一个 token 算作会话，用于以 `-` 开头的路径。
- `--port` 是 0 到 65535 的整数；`0` 由操作系统选择。
- `open` 和 `mcp` 不给就不设置，沿用 DevFrame 的默认值：打开浏览器，有 agent 工具时挂载 MCP 路由。
  `auth` 和 `index` 默认开启，只有 `--no-auth` 或 `--no-index` 才关闭。
- 写在命令名之前的会话或选项（`agent-trace --port 1 build x`）是用法错误：它属于 dev 服务器，而该命令
  不会启动 dev 服务器。

### 3.2 Dev server

`commands/dev.ts` 调用 `createDevServer(devframe, { host, port, mcp, auth, openBrowser, onReady })`：

- `port` 取 `--port`，否则取 `resolveDevServerPort(devframe, { host })`：定义里的 7392 或下一个空闲端口。
- 有启动会话时（路径、`AGENT_TRACE_PATH` 或 `--pick`），除非给了 `--no-open`，由 CLI 自己打开
  `?s=<traceId>`，DevFrame 不打开任何页面。没有启动会话时，除非给了 `--no-open`，由 DevFrame 打开会话浏览器。
- `--no-auth` 传入 `auth: false`；否则 CLI 自己打开浏览器时带上一次性验证码。
- `onReady` 依次恢复摘要计算、打印 Ready 行、打开浏览器。

`commands/dev.ts` 里的 `browserPlan` 是一个纯函数，承载上面关于打开浏览器和验证码的规则；
`commands/dev.test.ts` 检查每一种组合。

DevFrame 定义去掉只有 cac 适配器读取的 `cli.command` 和 `cli.configure`，保留 `cli.port`。

### 3.3 MCP

`commands/mcp.ts` 加载会话、填充 TraceStore，然后调用 `devframe/adapters/mcp` 的
`createMcpServer(devframe, { transport: 'stdio', onReady })`。stdout 只承载协议消息；ready 行和所有
失败都以纯文本行写到 stderr。

### 3.4 Failures

| Kind | Message | Fix line | Exit |
| --- | --- | --- | --- |
| `usage` | router 的问题描述（``unexpected: `--bogus` ``、`--port requires a value`、`port: expected a port number from 0 to 65535`、`out: expected a path; writing to stdout (-) is not supported`）、`--pick needs an interactive terminal`、`--pick cannot be used with a session path`、``put the session and options after `build` `` | `Run agent-trace --help for usage.` | 1 |
| `session`（`load`、`build`、`export`） | `Could not <action> <target>: <reason>` | `Pass a canonical agent-trace JSON file, or a session path a registered agent adapter accepts.` | 1 |
| `index` | `Could not index sessions: <reason>` | `Check the agent session directories, or pass --no-index.` | 1 |
| `no-sessions` | `No sessions to pick.` | 同 `session` | 1 |
| `cancelled` | 无（选择器自己打印取消行） | 无 | 1 |

用法错误和所有 `mcp` 失败都以纯文本行写到 stderr。其他失败通过 `sayError` 输出：终端里用 clack 的
错误样式，其他情况输出纯文本行。

### 3.5 Dependencies

- `@bomb.sh/router` `0.8.0` 加入 `apps/cli` 的 devDependencies 并被打包。它固定在包内而不是 catalog
  里，因为 catalog 只放两个及以上包共用的版本。现有的 notices 插件会把它的 MIT 许可证写进
  `THIRD-PARTY-NOTICES.txt`。
- `cac` 移出 `dependencies`，lockfile 也不再把它解析为 `devframe` 的可选 peer。`devframe` 和
  `@devframes/agentic` 仍是外部依赖。

### 3.6 Compatibility

不变：命令名、选项名和默认值、`AGENT_TRACE_PATH`（空值除外，见下文）、`AGENT_TRACE_REDACT`、退出码、
纯文本输出行、Ready 框、MCP 的 stdout，以及报告和导出文件。

变化：

- `--help` 使用 router 的版式并列出所有命令；`<command> --help` 描述该命令。
- `--version` 输出 `agent-trace <version>`（原来是 `agent-trace/0.0.0 <platform> node-<version>`）。
- 未知选项或第二个位置参数在任何命令上都会在开始工作前失败，措辞来自 router；`build --pretty` 现在会被拒绝。
- `--pick` 同时给出会话路径时失败；原来会忽略这个路径。
- 写在命令名之前的会话或选项会失败；原来会被忽略或误读。
- `--no-pick`、`--index` 和 `--auth` 按名字所表示的设置接受。
- 缺少值时提示 `--port requires a value`（原来是 `--port needs a value`）。
- `-h`/`--help` 和 `-v`/`--version` 出现在任何位置都会输出帮助或版本，包括旧解析器会把它们当作选项值的
  位置（`--port -h` 原来报 `--port needs a value`）。
- `--out -` 和 `--out-dir -` 会被拒绝，因为 CLI 不支持写到 stdout；旧解析器报的是缺少值。
- 空的 `AGENT_TRACE_PATH` 视为没有指定会话，所以 `build`、`mcp` 和导出命令使用演示 trace；原来会解析成
  工作目录然后失败。
- 同一个开关写两次（`--open --no-open`）会被拒绝；旧解析器取最后一个。
- `build`、`mcp` 或导出命令后面的 `--no-index`、`--pick` 会被拒绝；旧解析器接受后直接忽略。

## 4. Verification

- 单元测试：`cli/routes.test.ts` 覆盖 3.1 的每一行、`--`、以数字开头的路径、未知选项、缺少的值、作为
  输出路径的 `-`、端口范围、每个路由上的帮助和版本，以及两种帮助文本；`cli/app.test.ts` 覆盖版本行、
  3.4 的用法错误、`--` 之后的 token，以及 stdout 保持为空的 `mcp` 失败；`cli/commands/dev.test.ts` 覆盖
  `browserPlan`。移动过的测试除路径外不变，并全部通过。
- 集成测试：`apps/cli/test/cli-smoke.test.ts`（每次 `build` 只读一次文件、MCP 的 stdout），以及
  `apps/cli/test/report-build.test.ts`（一个脱敏的 `index.html`；它会启动 CLI，所以从
  `report/report-site.test.ts` 拆了出来）。
- Tarball：`test:smoke` 检查 `--help`（`agent-trace <version>`、`Usage:`、`--pick`、`export-otlp`）、
  `--version`，以及未知 flag 以退出码 1 失败且 stdout 为空；`test:e2e` 不变。
- 仓库检查：format、lint、typecheck、test、build、conventions、layers、translations 和 browser bundle。

## 5. Execution plan

### 5.1 Preconditions

分支从 #80（`feat/ledger-lane-view`）开始，它带有 #70 的 CLI。不包含 #81。

### 5.2 Completion contract

- 1.3 的目标都满足，4 的检查都通过。
- `AGENTS.md`、`docs/architecture/overview.md`、`docs/development/setup.md`、两份 README，以及
  `apps/web/src/shell/report.ts` 里的路径注释，都写的是新布局。

### 5.3 Execution order

一个 PR，分三个提交，每个提交都能构建。

#### Task 1: Group the modules

- Files：`apps/cli/src` 下所有模块和测试；提到它们路径的文档和注释。
- Change：用 `git mv` 移到 2.2 的目录；改写相对 import；把 kit 调用所需的 platform 类型移到 `sessions/`，
  命名为 `ShellPlatform`。
- Tests：现有测试，按新的目录深度调整 fixture 路径。
- Exit condition：`pnpm --filter @rivus/agent-trace test` 和 `typecheck` 通过，没有逻辑改动。

#### Task 2: Route the commands

- Files：`src/cli/{routes,app,help,failure}.ts`、`src/cli/commands/*.ts`、`src/main.ts`、
  `src/server/{devframe,trace-store}.ts`、`src/export/write-export.ts`、`src/cli/ui/terminal.ts`、
  `apps/cli/package.json`、`pnpm-lock.yaml`、`apps/cli/vite.config.ts` 和
  `apps/cli/scripts/third-party-notices.ts` 里关于打包的注释、`apps/e2e/src/cli.smoke.ts`，以及一个
  changeset；从 `src/report/report-site.test.ts` 拆出 `test/report-build.test.ts`；删除 `src/argv.ts`
  及其测试。
- Change：3.1 到 3.5。
- Tests：`cli/routes.test.ts`、`cli/app.test.ts`、`cli/commands/dev.test.ts`，以及 4 里的 `test:smoke` 用例。
- Exit condition：4 的所有检查通过，包括 `test:smoke` 和 `test:e2e`。

#### Task 3: Documents and release intent

- Files：本计划及其阅读版、`docs/plans/README.md`，以及 5.2 列出的文档。
- Exit condition：`node scripts/check-doc-translations.mjs` 和 `gh repo-checks repository` 通过。

### 5.4 Validation ledger

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| Task 1 | `pnpm --filter @rivus/agent-trace test` | 所有移动过的测试通过 |
| Task 2 | `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`node scripts/format.mjs --check` | 通过 |
| Task 2 | `cd apps/e2e && pnpm run test:smoke && pnpm run test:e2e` | 在安装后的 tarball 上通过 |
| Task 3 | `node scripts/check-*.mjs`、`gh repo-checks repository` | 通过 |

### 5.5 Rollback per batch

回滚这个 PR 即可。没有持久化数据变化：会话索引的布局和 `INDEX_CONTENT_REVISION` 都没动，报告和导出
文件逐字节相同。

## 6. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| `@bomb.sh/router` 还是 0.x，首个版本发布于 2026-09-30 | risk | 升级可能改变它的 API 或消息 | unconfirmed | 版本已固定，只有 `cli/` 引用它；`cli/routes.test.ts` 固定了消息 |
| `help.ts` 改写了 router 打印器的 usage 行和会话标签 | risk | 升级后打印器格式一变，帮助文本可能出错 | unconfirmed | `cli/routes.test.ts` 固定了两种帮助文本 |
| 解析 `--help` 或旧版 `--version` 输出的脚本 | risk | 低；两种格式都没有文档 | unconfirmed | 无 |
