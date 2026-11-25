> 中文阅读版。以英文原文 docs/plans/0010-dsh-plugin.md 为准。

<!-- source-blob: 3ebbf4b0f707de6df134f2d652741b9d5cc4b324 -->

# Plan 0010：作为 dsh 插件的 Estela

- 状态：in review
- 负责人：unconfirmed
- 审阅人：unconfirmed
- 最后更新：2026-11-24
- 配套 Spec：[`docs/specs/0010-dsh-plugin.zh-CN.md`](../specs/0010-dsh-plugin.zh-CN.md)

本 Plan 实现 Spec 0010：一个 dsh 插件，在 `dsh web` 内部显示当前会话的工作区。它由三部分组成：一个每个实例各有一份、
不导入 DevFrame 的 host core；`apps/web` 用自己的工作区构建出的 `<estela-workspace>` 元素；以及 `apps/dsh-plugin`，
通过 dsh 自己的 RPC 通道把前两者连起来的适配器。

为此在 dsh 0.2.2-rc.5 上做了两项验证：A1 把 `apps/web` 渲染在 Shadow DOM 里，并列出了它需要的每一处改动；A2 在
`dsh web` 里运行了一个第三方插件的 RPC 通道和 View。两项结果记录在 issue #109 的两条评论里（分别以「Verification A1」
和「Verification A2」开头的评论）；本 Plan 按名称和章节引用它们。两项验证都没有覆盖的内容列在第 7 节，每项都写明由哪个
批次来验证。

## 目录

1. 背景与目标
2. 概要
3. 详细设计
4. 上线与稳定性
5. 验证
6. 执行计划
7. 风险、未决问题与后续事项

## 1. 背景与目标

### 1.1 当前行为与约束

Estela，`main`（`44cb909`）：

- 工作区通过 `LoadClient` 加载（`apps/web/src/workspace/load-session.ts:53-63`）：`status`、`onStatus`、`loadTrace`、
  `traceView`、`event` 和 `subscribe`。`createSessionLoad(traceId, connect)` 接收构造 client 的函数
  （`load-session.ts:91`）。已加载的会话是 `{ traceId, trace, summary, event(id) }`（`:14-21`）。文件大小未知时，加载面板
  显示「加载中…」（`workspace/load-screen.tsx:27`）。
- `Workspace` 在这个函数之外访问 DevFrame client：`connectionLost()` 会打开它（`shell/connection.ts:9-29`），
  「导出报告」调用 `scopedClient()`（`workspace/export-report.tsx:44-45`）。
- 应用读写页面：路由读取 `location.hash` 并监听 `hashchange`（`shell/router.ts:19-27`）；`bootLocation` 改写 URL
  （`shell/boot.ts`）；`session-browser.tsx:135` 在 `window` 上监听 `keydown`。工作区通过 `document` 查找节点：
  `workspace/workspace.tsx:45` 和 `workspace/inspector/inspector.tsx:80`。
- 主题 token 定义在 `:root` 和 `html[data-theme]` 上（`styles.css:44`、`:49-50`、`:99`）；`html` 和 `body` 的页面默认值在
  `styles.css:138-150`。`initTheme` 写 `document.documentElement.dataset` 并读取 `matchMedia`（`shell/theme.ts:7`、
  `:25-27`）；`applyLocale` 写 `<html lang>`（`i18n/locale.ts:46-49`）。切换按钮在 `shell/top-bar.tsx:70-100`。
- RPC 绑定是模块状态：`packages/rpc/src/functions/service.ts:8`、`functions/trace-view.ts:68`（`:82-91`）、
  `functions/report.ts:20-21` 和 `publish.ts:5-6`。报告写入器靠一个模块级队列串行执行
  （`packages/server/src/report/report.ts:36-43`）。`createEstelaServer` 在 `setup` 里绑定它们
  （`packages/server/src/composition/estela-server.ts:125-131`），因此一个进程只服务一个 Estela 服务器（`:76`）。
- `TraceStore`（`packages/rpc/src/trace-store.ts`）不导入 DevFrame。它接收 `resolve`、`load`、`fs`、`readOriginal`、
  `present` 和 `log`（`:42-55`），并有 `open(traceId, owner?)`（`:150`）、`view`（`:183`）和 `event`（`:199`）。它保留
  最近 3 个 trace（`:17`、`:382`）。该文件有 499 行，比上限少一行。
- `createTraceStore` 解析 `current` 或会话目录，并通过 `present` 脱敏（`packages/server/src/store/trace-store.ts:55`、
  `:76`）。PR #172 给 `EstelaServerOptions` 加了 `reportDir` 选项，并让 `redacts` 成为会话文本的唯一开关
  （`estela-server.ts:28-39`）。
- `traceIdOf` 对代理、路径和会话 id 做哈希（`packages/server/src/sessions/session-target.ts:25-34`）。
- `scripts/check-layers.mjs:19-34` 需要为每个 workspace 包准备一条允许列表条目；`knip.ts` 需要一条 workspace 条目。
- `@rivus/estela` 是唯一发布的包（`CONTRIBUTING.md` 的 Release Intent 一节）。`publish.yml:35-42` 向共享的发布 workflow
  传入一条检查命令和一条审计范围。`scripts/check-release-intent.mjs:16-17` 只写了一个文档和一个包。

dsh 0.2.2-rc.5，来自两项验证及其 tag 为 `dsh-v0.2.2-rc.5`（`9c2670d3`）的源码：

- 插件是一个 npm 包，`dsh.bundle.patch` 指向一个 `cordis.patch.yml`。浏览器 UI 是一个经典脚本，以 `./client` 导出并在
  `dsh.client` 中声明；它调用 `window.__ModuleLoader__.load({ id, factory })`，`factory(require)` 返回
  `{ inject, apply }`（A2，第 4 节）。dsh 在每次页面加载时以 `/plugins/??<package>/client.js&rev=<rev>` 提供它，不需要
  cookie。
- `ctx.connection.rpc.handle(channel, handler)` 注册一个通道。在 rc.5 上，插件必须在 `inject` 里列出 `webServer`，并自己
  调用 `rpc` 的 getter
  （`Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ctx.connection), 'rpc').get.call(ctx.connection).handle(...)`）；
  直接写 `ctx.connection.rpc.handle(...)` 会抛出 `cannot get property "webServer" without inject`，插件无法激活
  （A2，第 1.2 节）。在 0.2.3-alpha.2 上直接调用可用（A2，第 8 节）。
- 浏览器调用 `ctx.connection.rpc.call(channel, endpoint, payload, signal?)`。`payload` 是必填的。结果是
  `{ ok: true, value }` 或 `{ ok: false, error: { code, message, details } }`。没有流：页面上 `rpc.open` 是 `undefined`
  （A2，第 2.3 节和第 5 节）。handler 抛出异常时，dsh 回复 500，并原样带上异常消息（A2，第 5 节）。
- 11,931,777 字节的结果在浏览器里五次运行的中位数是 105 到 116 ms；这次调用让页面的 JavaScript 堆增加约 35 MiB，dsh 的
  RSS 增加约 95 MiB。通道没有低于 V8 字符串上限的响应大小限制（A2，第 2 节）。
- 通道的路由只调用 dsh 的准入，不做别的。不带 cookie 是 401；另一个 `Origin` 或 `Host` 是 403。浏览器 cookie 和
  `/connect?token=` 签发的 API cookie 都能通过，两者的 principal 都是 `owner`（A2，第 5 节）。
- `ctx.sessionPersistence.stat(id)` 返回一个快照或 `undefined`；对尚未写入磁盘的会话，其 `location`（`{ kind, path }`）
  缺失（`packages/session/session-persistence/src/index.ts:51-68`）。
- 第三方插件用
  `ctx.slots.inject('conversation.view', () => ctx.slots.register({ name, id, order, label, inject }, Component))`
  注册对话 View。`dsh.client.inject: []` 时，标签页出现在 Trajectory 之后，占满宽度（A2，第 3 节）。
- 空白会话不显示任何 View 标签页：`DefaultConversationViews.tsx` 在 `turn/start` 之前返回 `null`（A2，第 3 节）。
- 卸载插件会在 `dsh web` 运行期间移除它的通道和 slot 条目：标签页约五秒钟后消失，通道像任意未注册路径一样回答 405，
  profile 不再列出该包（A2，第 6 节）。
- 客户端主题以 `getSnapshot()` / `subscribe` 发布，带 `active.colorScheme`
  （`ui-theme/src/client/index.ts:100-117`）；客户端语言以 `getSnapshot().active` 发布
  （`locale/src/client/index.ts:228-239`）。
- 安装时（`plugin-manager/src/operations.ts:363-381`）和 profile 启动时
  （`app-boot/src/compatibility-preflight.ts:79-83`、`:101-117`），dsh 用
  `semver.satisfies(runtime, range, { includePrerelease: true })` 检查 `engines.dsh`。

### 1.2 问题

想用 Estela 查看某个会话的 dsh 用户，必须离开 harness 再运行一条命令。要在 dsh 内部运行，需要仓库目前没有的三样东西：
一个能活在别的进程里的 host core、一个别的页面可以挂载的工作区元素，以及一个把它们接到 dsh 的会话和连接上的 dsh 包。

### 1.3 目标与成功标准

- Spec 0010 的 DSH-1 到 DSH-14 在 Spec 指明的测试中通过。
- `estela` 命令行的行为与之前相同：同样的 RPC 名称、输入和结果；CLI 冒烟和 Playwright 套件不变并通过。
- 所有 dsh 专用的代码都在 `apps/dsh-plugin` 里。
- 插件是第二个发布的包，由 Publish workflow 发布。

### 1.4 非目标

- 公开 SDK：不发布 `@rivus/estela/server` 或 `@rivus/estela/embed` 入口（D3）。
- `/estela` 命令、dsh 内的会话浏览器、实时跟随、时间视图、dsh 内的「导出报告」、从 dsh 导出 ATIF 和 OTLP、Dim、
  dsh Desktop，以及 TUI profile。
- 对内核、视图预算或 kit 的改动。

## 2. 概要

### 2.1 设计原则

- 插件不添加任何比它自己活得更久的东西：没有端口、进程、路由、文件，也没有全局变量。
- 只有一条工作区代码路径。命令行和元素用同一个视图 trace 渲染同一批 Solid 组件；元素只在数据、主题和语言的来源上
  不同。
- 未知输入只在进入的地方解析一次：通道的 handler 用 `zod/mini` schema 解析每个载荷，与 DevFrame 的 handler 做法相同
  （`packages/rpc/src/functions/parse-input.ts`）。
- dsh 的接口按原样使用，由一个冒烟测试钉住，不为第二个 harness 做抽象（D2）。

### 2.2 边界与职责

| 目录 | 本次改动后负责的内容 |
|---|---|
| `packages/rpc/src` | RPC 函数定义，每个服务器实例各建一份；会话发布器，每个实例一份 |
| `packages/server/src/core/` | `createEstelaCore`：一个不含 DevFrame、也不含会话目录的 Estela 服务器的各项服务（平台、TraceStore、脱敏） |
| `packages/server/src/composition/` | `createEstelaServer`：会话目录、core，以及绑定 core 各项服务的 DevFrame 定义 |
| `apps/web/src/embed/` | `<estela-workspace>` 元素、它的 `source` 接口定义，以及 document 级的样式表 |
| `apps/web/src/shell/` | 独立应用的 shell：路由、DevFrame client、连接监视和「导出报告」；它把加载器和连接状态交给共享的工作区 |
| `apps/dsh-plugin/src/host/` | dsh 的 host 半边：插件模块、`/estela` 通道、从 dsh 会话 id 到日志文件 |
| `apps/dsh-plugin/src/contract/` | 通道的端点、输入、结果和错误码；两个半边共同导入的唯一文件 |
| `apps/dsh-plugin/src/client/` | dsh 的 client 半边：对话 View、来自 dsh 的主题和语言 |
| `apps/dsh-plugin/scripts/`、`vite.config.ts` | host 构建产物，以及 dsh factory 格式的 client 构建产物 |

### 2.3 主路径

```text
dsh web page (React 18, dsh's own)
  conversation.view slot -> EstelaView (apps/dsh-plugin/src/client, React)
    |  ctx.connection.rpc.call('/estela', 'session/open', { sessionId })
    |     host: ctx.sessionPersistence.stat(sessionId) -> log path, size, mtime -> traceId
    |  ctx.connection.rpc.call('/estela', 'trace/view', { traceId })
    |  ctx.connection.rpc.call('/estela', 'trace/event', { traceId, id })  (when an event is selected)
    |     host: rpc.handle('/estela', handler) -> createEstelaCore -> TraceStore -> kit dsh reader
    v
  <estela-workspace source=... data-theme=... lang=...>   (Shadow DOM; Solid inside)
    the workspace: projections, reconstruct, diffContext, priceTrace run in the browser
```

### 2.4 设计决定

owner 的决定，录自 issue #109（2026-11-24）：

| 编号 | 决定 | 理由 |
|---|---|---|
| D1 | 插件及其打包的代码采用 GPL-3.0-only 许可证。 | GPL 的义务附着在传送作品上；没有人传送插件与 dsh 的组合。可以导入 dsh 的 MIT 包。 |
| D2 | 插件支持其 CI 冒烟测试所运行的 dsh 范围；`engines.dsh` 写明该范围。破坏插件的 dsh 版本会换来一个带新范围的插件版本。 | dsh 处于候选发布阶段，其扩展点不承诺兼容性。所有 dsh 专用代码都留在 `apps/dsh-plugin`，dsh 的变化只触及一个包。 |
| D3 | embed SDK 不是公开接口。插件打包 host core 和元素，作为一个有自己 semver 的正常版本发布。它的公开面是安装命令、Estela 视图和 `engines.dsh`。 | 冻结在 1.0 的公开 SDK 只有一个使用者，而实时跟随（#104）会改变 `source` 的形状。 |

本 Plan 的决定：

| 编号 | 决定 | 备选方案与理由 |
|---|---|---|
| T1 | 包名 `@rivus/dsh-estela`。 | 在 awesome-dsh-plugin 中抽样 45 个条目，能读到根包名的 41 个里有 36 个命名为 `dsh-<name>`：31 个不带 scope，5 个在作者的 scope 下。列表里已有的四个会话查看器都带这个主干（`@240xu/dsh-session-lazy-view`、`dsh-llm-capture`、`dsh-llm-inspector`、`dsh-context-console`），样本里没有一个带 `-plugin` 后缀。`@rivus` scope 属于 owner，2026-11-24 这一天该名称在 npm 上未被占用。 |
| T2 | 目录 `apps/dsh-plugin`，下设 `src/host/`、`src/client/`、`src/contract/`、`scripts/`、`test/` 和 `assets/`。 | 两个半边加载在不同的运行时里，只共用 contract。 |
| T3 | 两个构建产物。`dist/host.mjs` 打包 `@rivus/estela-server/core` 及其可达的每个 `@rivus/*` 包，连同 kit、`zod` 和 `es-toolkit`，做法与 CLI 相同（`apps/cli/vite.config.ts:10-11`）。`dist/client.js` 是一个 dsh factory 格式的经典脚本。`dependencies` 保持为空。 | 运行时依赖会装进 dsh 的 hoisted profile，在那里可能与其他插件冲突。CLI 已经把 DevFrame 以外的一切打包进去。 |
| T4 | RPC 函数定义按服务器实例构建：`createServerFunctions(services)`、`createReportFunctions(services)` 和 `createSessionPublisher()` 取代原来的常量和 `bind*` 函数。 | 模块级的 `let` 会在第二个服务器绑定时改写第一个服务器。工厂是保持定义对象、名称和 handler 不变的最小改动。 |
| T5 | 允许一个进程里出现第二个服务器。不抛出任何错误。 | 有了 T4，就没有剩下会冲突的模块状态。issue 里「抛出」的前置项针对的是单例。两个服务器共享的东西与两个进程共享的相同：环境和会话索引文件。 |
| T6 | 不含 DevFrame 的 core 是一个包入口 `@rivus/estela-server/core`（`packages/server/src/core/estela-core.ts`），并由一条 lint 规则保证 `packages/server/src/core/**` 不导入 `devframe`，也不导入会话目录。 | 靠 tree-shaking 把 `devframe` 从 barrel 里去掉取决于打包器的行为。入口让这条边界成为结构性的。 |
| T7 | 一个通道 `/estela`，三个一元端点（3.3.2）。 | dsh 的类型化 Remote 需要生成的产物。每次调用一条路由只会无谓地增加接口面。 |
| T8 | 已加载的日志用 trace id 标识，它对日志路径及其大小和修改时间做哈希；`session/open` 每次都重新计算。host 保留最近签发的 16 个 id 及其文件标记，并在为较早的 id 重新读文件之前先核对标记：不一致时回答 `estela/stale`，由 client 重新打开会话。 | TraceStore 以键做缓存。没有时间戳标记的话，会话增长之后重新加载页面仍会显示旧快照，直到 dsh 重启。dsh 自己的 `revision` 是不透明令牌，不能用作键。存储层还会丢弃快照，并为缺失的条目重新读文件；没有这项核对的话，旧的 View 可能用旧 id 读到已经变化的日志。 |
| T9 | 每次 `trace/view` 调用对加载各取一份自己的持有，在调用结束或其 `signal` 触发时释放。不传 owner。 | 浏览器套接字共用一个 owner Peer，所以如果用 owner 让一个浏览器连接取代自己的加载，一个标签页就能取消另一个标签页的加载。 |
| T10 | 加载时显示不确定进度的指示。没有进度端点。一次加载最多阻塞 dsh 的事件循环约 N ms；N 由冒烟测试测得（3.9）。 | 页面上没有流（A2，第 5 节）。100 MB 的日志在笔记本上加载需要 0.5 到 0.9 秒，12 MB 的视图过通道约 0.1 秒，所以每 200 ms 轮询一次只能画出几次更新。轮询没有测过。加载面板已经有这个状态（`load-screen.tsx:27`）。加载本身跑在 dsh 的事件循环上：平台在那里解压（`packages/server/src/sessions/node-platform.ts:59`），内核在那里拟合视图（`packages/kernel/src/view.ts:273`）。把这部分工作挪到 worker，不在本 Plan 里设计。 |
| T11 | host 半边在 `inject` 里列出 `webServer`，并自己调用 `rpc` 的 getter（3.3.1）。它不注册自己的路由。`engines.dsh` 从 0.2.2-rc.5 起。 | 在 rc.5 上，按文档的写法插件无法激活（A2，第 1.2 节）。插件自己注册的路由在 rc.5 上可用，在 alpha.2 上回答 400（A2，第 1.3 节）。rc.1 到 rc.4 没有运行过，所以不声明它们（D2）。 |
| T12 | handler 检查对等方：principal 不是 `owner` 的一律拒绝。它不让任何异常到达 dsh，自己写的消息里不含路径。 | 这条路由仅靠 dsh 的准入（A2，第 5 节），而非 owner 的对等方能否到达它没有测过。dsh 会把抛出的异常消息原样发给调用方，而存储层之外的错误可能带有路径。 |
| T13 | 元素的主题（`data-theme`）、语言（`lang`）以及可选的宿主设计令牌（`--estela-host-*` 自定义属性）由 client 半边从 `ctx.theme` 和 `ctx.locale` 传入。元素不绘制切换按钮、Estela 顶栏和重复的会话 `h1` 标题，改为绘制单行紧凑统计栏加「跳转」入口（`⌘K` / `Ctrl+K`）。 | 用户已经在 dsh 里选过主题、语言和当前会话。通过 `--estela-host-*` 承接 dsh 实时的 `--dsw-*` 表面、边框、文字、强调色、字体族和圆角令牌，可以让视图自然融入 Chat 与 Trajectory 标签页，同时不硬编码色值、不放进宿主页同名 `:root` 变量；Estela 保留自己的事件类别色（`--kind-*`）、字号和固定事件列表行高，保证虚拟滚动与时间线测量准确。 |
| T14 | 首版不提供「导出报告」。只有在宿主提供时元素才绘制这个按钮，而没有任何宿主提供。 | 报告需要独立的 web 构建和 DevFrame 的 `createBuild` 在 dsh 进程里运行，这一点未经验证，而且它会把带有绝对输出路径的构建日志打印到 dsh 的终端（`packages/server/src/report/report.ts:140-143`）。它还会让插件提供的浏览器代码大约翻倍。dsh 没有选择目录的途径，所以文件会落在用户没有选过的地方。命令行的 `build` 和「导出报告」仍是获取报告的途径。 |
| T15 | 插件只显示当前会话。dsh 内没有会话浏览器，空白会话也没有入口。 | dsh 的会话列表两次点击就能到达每个已开始的会话。会话浏览器需要在 dsh 里运行会话目录和会话索引、在元素里再加一个界面，以及一个 `conversation.view` 以外的入口，而没有任何验证运行过这样的入口。 |
| T16 | 首版没有 `/estela` 命令。owner 已于 2026-11-24 决定。 | 在 rc.5 上，命令无法选中 View：选中的 View 是 conversation store 的 `view`，只有 slot 组件能访问它（`ui-conversation/src/client/skeleton/DefaultConversationViews.tsx:19-20`）；`ctx.conversation` 和 `ctx.uiConversation` 都不能选中它，`binding.activate` 只是把一个 target 标记为需要组装。标签页就在一次点击之外。靠点击 dsh 标签页 DOM 的命令会依赖 dsh 没有承诺的标记结构。以后再加命令是纯新增。 |
| T17 | client 半边是一个不用 JSX 的 React 18 组件。它拥有 `<estela-workspace>` 元素，通过 ref 设置 `source` 和各属性；Solid 只运行在元素的 shadow root 里。`react` 来自 factory 的 `require`。 | dsh 的 shell 是 React 18，它的 slot 系统渲染 React 组件。Solid 和 React 从不共享一棵树：React 拥有宿主元素的属性和特性，Solid 拥有它的 shadow root。用 `createElement` 避免在一个包里出现两套 JSX 运行时。 |
| T18 | embed 代码是 `client.js` 的一部分。没有第二个文件。 | dsh 加载插件额外文件的机制和分块加载都没有验证过（A2，第 9 节）。单个脚本是唯一实际运行过的交付方式。它的代价是 dsh 每次页面加载最多多出约 122 kB gzip，即今天 web 构建产物的大小；embed 只会让它更小，不会更大。T24 的预算看住它。 |
| T19 | document 级的规则放进一个只装 `@property` 规则的 `<style>` 元素，在第一个元素连接时添加，在最后一个元素断开时移除。embed 不注入 `@font-face`：在 dsh 内通过 `--estela-host-font-sans` / `--estela-host-font-mono` 承接 `--dsw-font-family` 和 `--ds-font-family-code`，这些宿主变量不存在时回退到系统字体族。owner 于 2026-11-24 决定不带 web 字体，2026-11-25 补充轻量承接宿主令牌。 | `<style>` 和 `CSS.registerProperty` 渲染结果相同（A1，第 2.2 节），而且构建已经把这些规则产出为文本。在该 tag 上检索 dsh 的 web 服务器、web 客户端和 connection 包的源码，找不到 `Content-Security-Policy` 头。不带 web 字体，每次 dsh 页面加载少约 120 kB gzip，插件也不往宿主页的字体命名空间里加东西。承接 dsh 字体族让排版与 Chat、Trajectory 一致，同时保持 Estela 自己的字号和固定事件列表行高。 |
| T20 | `engines`：`{ "dsh": ">=0.2.2-rc.5 <0.3.0-0", "node": ">=24.9.0" }`。没有 `peerDependencies`。 | 下限是冒烟测试运行的版本（D2）。上限排除下一个 minor；在 0.2.3-alpha.2 上，通道、View 和包格式仍然可用（A2，第 8 节）。Node 范围是 dsh 在 rc.5 上自己的要求，所以它永远不会成为拒绝的原因。插件在运行时不导入任何 `@deepseek-ai/*` 包，所以没有需要共享的实例，也没有会与预发布版本冲突的 peer 范围。 |
| T21 | 冒烟测试是 `apps/dsh-plugin/test/dsh.smoke.ts`，由它自己的 CI job `dsh-plugin` 在 Linux 上运行，固定版本的 dsh 装在一个临时前缀里。每周一次和手动的运行使用 dsh 的 `latest` 标签。 | dsh 安装后是 1.3 GB；作为 workspace 的 devDependency，它会进入每一次安装。`latest` 的运行是 D2 需要的信号。 |
| T22 | 插件可以依赖 `@rivus/estela-server`（其 `core` 入口）和 `@rivus/estela-web`（其 `embed` 入口，构建时），可以使用 `@rivus/agent-kit`、`@rivus/estela-rpc` 和 `@rivus/estela-schema` 的类型。 | 它通过 core 读会话，并提供元素；运行时不导入其他任何东西。 |
| T23 | 发布：`.changeset/config.json` 不变。包在批次 10 之前保持 `private: true`；批次 10 在同一个 pull request 里把它改成 public，同时完成 npm 首发、发布检查、接口文档和第一份 changeset。`publish.yml` 也构建插件，并审计两个范围。插件覆盖的接口面在 `docs/reference/public-interface.md` 里占一节，`check-release-intent.mjs` 按所在章节把一次改动归到某个包。插件有自己的版本号，不进 `fixed` 组。 | Changesets 为每个公开包定版本并发布：一个在能发布之前就公开的包，会在 `first-publish` 处挡住 CLI 的发布；也没有 changeset 可以写一个 private 包的名字。插件的 semver 是它自己的（D3）。 |
| T24 | `scripts/budgets/budgets.mjs` 增加四项大小预算：`client.js` 的原始大小和 gzip 大小（gzip 最多约 122 kB，因为 embed 不带 web 字体）、`dist/host.mjs`，以及插件 tarball。T10 的加载阻塞是冒烟测试里的一个上限，不是预算行。 | dsh 在每次页面加载时加载每一个已安装的 client 包（T18）。 |
| T25 | client 半边把元素包在一个 `div` 里，并按 dsh 滚动区域的尺寸以像素设置这个 `div` 的高度。**未验证；批次 7 先验证它。** | dsh 在一个滚动区域里按内容决定 View 的大小（`ui-conversation/src/client/skeleton/ConversationRoot.module.css`，`.viewArea`：在 active 阶段是 `flex: 1 0 auto; min-height: auto`），而工作区需要一个确定的高度来承载虚拟化的事件列表。A1 是在一个把全部高度给元素的宿主里测量元素的。 |

## 3. 详细设计

### 3.1 每实例一个 host core

#### 3.1.1 每实例一份 RPC 服务（`packages/rpc`）

- `functions/service.ts`、`functions/trace-view.ts`、`functions/report.ts` 和 `functions/list-sessions.ts` 保持各自的定义
  对象和 handler。每个模块的 `let` 及其 `bind*` / `require*` 函数去掉。定义由闭包捕获一个服务对象的函数构建。
- `index.ts` 导出：

```ts
export interface ServerServices {
  store: TraceStore
  listSessions?: (input: ListSessionsQuery) => Promise<ListSessionsResult>
  exportReport?: (input: ExportReportInput) => Promise<ExportReportResult>
  /** The one report a build bakes; `writeReport` sets it right before DevFrame builds. */
  reportSource: ReportSource
}
export function createServerFunctions(services: ServerServices): ServerFunctions
export function createReportFunctions(services: Pick<ServerServices, 'reportSource'>): ReportFunctions
export function createSessionPublisher(): SessionPublisher   // { bind(publish), emit(signal) }
export function createReportSource(): ReportSource           // { set(next: () => Promise<ReportTrace>) }
```

- `ServerFunctions` 和 `ReportFunctions` 是各工厂返回值的元组类型。DevFrame 的模块扩充（`index.ts:52-55`）用它们取代
  `typeof serverFunctions` 和 `typeof reportFunctions`，因此 `apps/web` 调用的名称（`load-trace`、`get-trace-view`、
  `get-event`、`reconstruct`、`export-report`、`list-sessions`）仍然有类型。
- 定义找不到自己的服务时，抛出的消息与今天相同：对没有会话目录的服务器，`'session service is not bound'` 变成
  `'list-sessions is not available'`，`listSessions` 本来就有这项检查（`functions/list-sessions.ts:35`）；
  `'trace store is not bound'` 和 `'export-report is available only on the dev server'` 不会再出现，因为服务对象是随服务器
  一起构建的。
- `packages/server/src/catalog/session-catalog.ts:6`、`:358` 调用模块里的 `emitSessions`。`CatalogOptions` 增加
  `announce?: (signal: SessionsSignal) => void`，由 `createEstelaServer` 传入发布器的 `emit`。
- `packages/server/src/report/report.ts`：模块级的 `queue`（`:36-43`）变成一个由 `createEstelaServer` 创建、再传给
  `writeReport`、`exportReport` 和 `buildSite` 的队列。`buildSite`（`:140-143`）在该实例的 source 上调用
  `reportSource.set(...)`，取代 `bindReportSource`。
- `composition/definition.ts:31-79`：`defineEstela(app, functions, report, services)` 注册传给它的函数，绑定传给它的发布器。
- `composition/estela-server.ts:78-145`：`createEstelaServer` 构建服务对象、函数元组和定义。`setup` 保持原有顺序
  （启动会话加载、会话目录启动、代理工具、共享状态）；`EstelaServer` 增加 `writeReport(outDir, report)`，
  `apps/cli/src/entry/commands/build.ts:41` 用它取代那个自由函数。自由的 `writeReport` 和 `exportReport` 不再从
  `packages/server` 导出。

命令行的行为不变，因为线上传输的接口面没有变化：同样的定义、同样的名称、输入 schema 和 handler，每个服务器注册一次，
而 CLI 每个进程只创建一个服务器。

#### 3.1.2 不含 DevFrame 的 core（`packages/server/src/core/`）

- `core/estela-core.ts` 放 `createEstelaCore(options): EstelaCore`，选项如下：

```ts
export interface EstelaCoreOptions {
  /** Reads, the home directory, and the environment. Defaults to `createShellPlatform()`. */
  platform?: ShellPlatform
  /** Redact the session text the core returns. */
  redacts: boolean
  /** Resolves trace ids: the session catalog on the dev server; a host's own ids, as the plugin's. */
  resolve?: (traceId: string) => ResolvedSession | undefined
  /** Where the TraceStore's warnings go, one line each, redacted like the store; omit to drop them. */
  log?: (line: string) => void
}
```

- core 创建平台和 TraceStore，返回 `store`、`seed(session, trace)` 和 `redact`（一个跟随 `redacts` 的文本脱敏器）。它既不导入 DevFrame，也不导入 `SessionCatalog`：会话目录经由会话索引到达 `node:sqlite`（`packages/server/src/catalog/session-catalog.ts:6`），而插件的 host 包不能带它。T6 的 lint 规则同时保证 `packages/server/src/core/**` 不从 `packages/server/src/catalog/` 导入。
- `createEstelaServer` 在今天的位置构建会话目录（`estela-server.ts:81-88`），并把 `resolve: traceId => catalog.resolve(traceId)` 交给 core。`openLaunch`、`open` 和 `close` 留在组装处，所以会话目录的启动、摘要和关闭都留在原处，`EstelaServer` 的每个成员都保持不变。
- core 重新导出 `traceIdOf`，供自己生成键的宿主使用。`packages/server/package.json` 增加 `"./core": "./src/core/estela-core.ts"`。由于 `@rivus/estela-rpc` 根 barrel 导入 `devframe` 并在顶层调用 `devframe/rpc` 的 `createDefineWrapperWithContext()`（打包器无法将其树摇掉），`packages/rpc/package.json` 同步导出 `"./trace-store": "./src/trace-store.ts"`（包含 `TraceStore`、`CURRENT_TRACE_ID` 和 `SnapshotChangedError`），`packages/server/src/store/trace-store.ts` 与 `core/` 从 `@rivus/estela-rpc/trace-store` 导入，lint 规则同时覆盖 `core/**` 与 `store/**` 并禁止其中导入 `@rivus/estela-rpc` 根入口。`ResolvedSession` 带有可选字段 `expect?: FileStamp`（`{ size, mtimeMs }`）；传入时，`TraceStore` 在 `entryOf` 之后、`remember` 之前检查 `target.path`，不一致时抛出 `SnapshotChangedError` 且不缓存，不传 `expect` 的调用方（开发服务器和会话目录）行为不变。
- `sessions/redaction.ts:2` 从 `@rivus/estela-runtime-node` 的 barrel 导入 `homeDir`，而这个 barrel 同时导出会话索引。对构建产物的检查（3.5.2）才是打包器丢掉了索引的证明。如果没有丢掉，就给 `homeDir` 在 `packages/runtime-node` 里单开一个入口。

### 3.2 嵌入元素（`apps/web`）

#### 3.2.1 元素及其 `source` 接口定义

- `apps/web/src/embed/index.ts` 导出 `defineEstelaWorkspace()`，在 `<estela-workspace>` 尚未定义时定义它。
  `apps/web/package.json` 增加 `"./embed": "./src/embed/index.ts"`。
- `apps/web/src/embed/estela-workspace.ts` 是这个元素。它挂一个 open 的 shadow root，加入样式表中属于 shadow root 的
  部分，再用 Solid 把 `Workspace` 渲染进去。断开连接时，它销毁渲染及其监听器。`data-theme`（`light` 或 `dark`）和
  `lang`（`en` 或 `zh-CN`）是受观察的属性。
- `source` 是一个属性（property），因为 React 18 会把自定义元素上的对象 prop 设为特性（attribute）。设置它就挂载
  会话；每次重试时元素会再向它请求：

```ts
export interface WorkspaceSource {
  /** Opens the session and resolves when its log is read and the view is built. Called again on every retry. */
  open(): Promise<TraceViewResult>
  /** One event in full, of the view identified by `traceId` (the id returned by `open`). */
  event(traceId: string, id: string): Promise<EventDetail>
}
/** `open` rejects with it when the session has not written a log yet. */
export class NoLogError extends Error {}
/** `event` rejects with it when the log changed since the view was built; the element then calls `open` again. */
export class StaleError extends Error {}
```

- `apps/web/src/embed/load-client.ts` 把 `WorkspaceSource` 适配成 `createSessionLoad` 接收的 `LoadClient`，这样那段流程
  不用改：`loadTrace` 立即以文件大小 0 返回（面板显示「加载中…」），`subscribe` 返回一个空的可迭代对象，`traceView`
  调用 `open` 并从它的结果取 trace id，`event` 带着当前视图的 trace id 调用 `event(traceId, id)`。
- `NoLogError` 变成带 `noLog: true` 的 `LoadFailure`（`load-session.ts:24-31`），此时 `ErrorPanel` 只显示「这个会话的
  日志尚未写入磁盘。」，不显示别的。
- 「重试」和 `event` 抛出的 `StaleError` 都会重新运行加载，也就是再调用 `open`。所以 `open` 每次都调用 `session/open` 的
  source（3.4.1）重试的是会话，不是被拒绝的那次加载。一个测试让 `open` 先拒绝一次再成功：工作区渲染出来，元素和
  它的 `source` 都没有被替换。
- 元素内部的加载路径（加载、就绪、各错误状态）A1 没有运行过，它用的是报告模式。批次 4 和批次 5 覆盖它。

#### 3.2.2 `apps/web` 中的改动

每一行是 A1 指出的一处改动。「实测」表示 A1 有它的像素数据或探针数据；「只读」表示 A1 读过代码，但没有运行那条路径。

| 编号 | 位置 | 改动 | 依据 | 批次 |
|---|---|---|---|---|
| A1 | `styles.css:4-8`（fontsource 的导入） | embed 里不做：它不注入 `@font-face`，使用回退字体族（T19）。Chrome 不应用 shadow root 里的 `@font-face`，所以文字用回退字体绘制。 | 实测（`none`） | 4 |
| A2 | Tailwind 生成的 `@property` 规则 | 同样处理。没有它们，`box-shadow` 和工具类的边框宽度会失去初始值。 | 实测 | 4 |
| A3 | `styles.css:44`、`:49-50`、`:99` | token 选择器同时匹配 `:host` 和 `:host([data-theme="…"])`；`color-scheme` 在同一个块里。宿主页的同名 token 继续进不来，而 `:host` 通过显式的 `--estela-host-*` 变量承接宿主的表面、文字、边框、强调色、圆角和字体族（`:root` / `html[data-theme]` 保持不动，确保 CLI 零像素变化）。 | 实测 | 3 |
| A4 | `shell/theme.ts:21-28` | `apply()` 同时把 `data-theme` 写到元素上。 | 实测 | 3 |
| A5 | `i18n/locale.ts:46-49` | `applyLocale()` 同时把 `lang` 写到元素上，这样内部的 `:lang()` 不再跟随宿主页。 | 实测 | 3 |
| A6 | `main.tsx:14` | embed 入口把元素的 shadow root 作为挂载节点。 | 实测 | 4 |
| A7 | `shell/router.ts:19-27`、`shell/boot.ts` | 不改。embed 入口都不导入。 | 只读 | 5 |
| A8 | `shell/router.ts:21`、`browser/session-browser.tsx:135` | 不改。embed 入口都不导入。 | 只读 | 5 |
| A9 | `workspace/workspace.tsx:44` | 元素不绘制「导出报告」按钮。 | 已核对 class | 3 |
| B1 | `styles.css:138-150` | `:host` 声明 `display: block`、`height: 100%`、`margin: 0`、背景色和前景色、字体族、`font-size: 13px`、`line-height: normal` 和抗锯齿平滑。 | 实测 | 3 |
| B2 | `styles.css`（`:host`） | 先写 `all: initial`，再写 `tab-size: 4` 和 `-webkit-text-size-adjust: 100%`。 | 实测 | 3 |
| B3 | `workspace/timeline/timeline.tsx:17` | 标签字体取元素的计算样式字体，不取 `document.body` 的。 | 实测 | 3 |
| B4 | `workspace/workspace.tsx:45` | 「跳转到」从工作区根节点查询，不用 `document`。 | 实测 | 3 |
| B5 | `workspace/inspector/inspector.tsx:80` | 方向键聚焦在标签列表里找到的下一个标签，不通过 `document.getElementById`。 | 实测 | 3 |
| B6 | `shell/theme.ts:27` | 删除 `root.dataset.kbTheme`；没有任何地方读它。 | 实测 | 3 |
| B7 | `workspace/export-report.tsx:73` | 不改。该组件不在 embed 入口里。 | 只读 | — |
| B8 | `shell/connection-lost.tsx:19`、`browser/session-browser.tsx:211`、`workspace/workspace.tsx`、`workspace/session-header.tsx`、`workspace/error-panel.tsx:47` | 元素里没有 `location.reload()`、`#/` 链接、Estela `TopBar` 和重复的会话 `h1`：`embedded` 模式下 `Workspace` 省略 `TopBar`、在底部用 `border-b border-border` 与 dsh 输入区干净分隔并绑定 `⌘K` / `Ctrl+K`（跳过宿主可编辑输入控件），`SessionHeader` 绘制单行紧凑统计栏加「跳转」按钮；`ErrorPanel` 省略返回链接和刷新；另外两个文件不在 embed 入口里。 | 只读 + 冒烟 | 3、5 |
| B9 | `shell/report.ts:62` | 不改。报告模式不在 embed 入口里。 | 只读 | — |
| B10 | embed 入口 | document 级的一个 `<style>` 元素，只装 `@property` 规则（T19）。 | 实测，两种方式都测了 | 4 |

标为「只读」的行在批次 5 里检查一次：把元素挂载在一个宿主页里，走一遍「跳转到」、标签键、「重试」和一次失败的加载，
然后确认宿主页的 `location.href` 前后相同。

#### 3.2.3 样式表

- `apps/web/vite.config.ts` 只在 embed 模式下把五个 fontsource 导入（`styles.css:4-8`）解析成空模块，所以 embed 的
  样式表里没有 `@font-face`，也没有字体文件。命令行构建照旧保留它们。
- `apps/web/src/embed/stylesheet.ts` 按顶层规则把样式表拆成给 document 的 `@property` 规则和给 shadow root 的其余部分。
  A1 的 harness 用同样的方式拆分，数出 60 条 `@property` 规则，没有一条被截断。一个测试对构建出的样式表做同样的
  计数，并检查两部分拼回去等于输入。
- document 部分是每个 document 一个 `<style data-estela-shared>`，只要还有一个元素处于连接状态就保留。

#### 3.2.4 embed 构建

- `apps/web/vite.config.ts` 接受一个模式：`vp build` 与今天的应用相同；`vp build --mode embed` 把元素构建到
  `apps/web/dist-embed/`，样式表是一个字符串，不带字体。`apps/web` 的 `build` 脚本两个都运行。`.gitignore` 增加
  `dist-embed/`，所以 CLI 对 `apps/web/dist` 的复制（`apps/cli/vite.config.ts:18`）和 tarball 的文件列表
  （`apps/e2e/src/cli.smoke.ts:75-93`）都不变。
- embed 入口既不导入 `devframe/client`，也不导入会话浏览器、路由和报告模式。一个测试在构建产物上断言不含 `devframe`。
- `dist-embed/` 是测试用的产物：它供 `apps/e2e/src/e2e/embed.e2e.ts` 使用，也就是 A1 用的那个 harness 页面。插件从源码
  打包同一个入口（3.5.2）。

#### 3.2.5 shell 的拆分

- 今天 `Workspace` 自己去访问 DevFrame client：横幅用 `connectionLost()`（`workspace/workspace.tsx:56`），
  `createSessionLoad` 的默认 `connect` 也是（`load-session.ts:65-78`，它会打开 `devframeClient`）。共享的工作区不再做
  这两件事。`Workspace` 多接收三个 prop：`connect`，即加载器（`createSessionLoad` 不再有默认值）；`lost`，一个读取
  连接状态的访问器，宿主没有连接状态时不传；`export`，画在「导出报告」位置上的元素，宿主不提供时不传。
- `apps/web/src/shell/app-shell.tsx` 是独立应用的 shell。它用 `devframeClient` 和 `scopedClient` 构造 `connect`
  （`load-session.ts` 里的 `defaultClient` 移到这里），并传入 `lost = connectionLost` 和 `<ExportReport>` 元素。
  `app.tsx` 渲染它，取代直接渲染 `<Workspace>`。会话浏览器保留它自己的 `connectionLost()`。
- 元素传入 3.2.1 的适配器，另外两个 prop 都不传（批次 4）。
- 测试在 `apps/web/src/workspace/workspace.test.tsx` 里：用假的 `connect` 渲染 `Workspace`，就绪的视图渲染出来；`lost`
  变为 true 时横幅出现；不传 `lost` 时横幅从不出现；不传 `export` 时没有按钮。3.2.4 的构建产物测试
  （`dist-embed/` 里没有 `devframe`）是共享的工作区碰不到 DevFrame client 的证明。

### 3.3 dsh 适配器：host 半边

#### 3.3.1 插件模块

- `src/host/index.ts` 导出 `name`、`inject` 和 `apply(ctx)`。`inject` 是
  `['connection', 'webServer', 'sessionPersistence']`：`webServer` 是因为 `rpc.handle` 在调用方的 scope 里通过它注册
  路由，`sessionPersistence` 用于取得会话的日志路径。
- `apply` 创建 core，只有当 core 的平台环境里 `ESTELA_REDACT=0` 时 `redacts` 才为 false；并传入它自己的 `resolve`。
  它在 `ctx.effect` 里注册通道。处置函数释放所有打开的持有，并清空已签发的 id。
- 加载时不启动任何东西。只有浏览器请求时才读取日志。
- `src/host/rpc.ts` 是到达 `rpc` 的唯一位置：

```ts
const connection = ctx.connection
const rpc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(connection), 'rpc')?.get?.call(connection)
  ?? connection.rpc
```

  这个 getter 调用在 rc.5 上可用，在 alpha.2 上也可用（A2，第 1.2 节和第 8 节）。如果以后的 dsh 把 `rpc` 变成普通属性，
  回退到文档里的调用。冒烟测试同时钉住范围和这个调用。

#### 3.3.2 通道

`src/contract/channel.ts` 为两个半边保存端点名、输入和结果的 TypeScript 类型、错误码，以及输入的 `zod/mini` schema。

| 端点 | 输入 | 结果 | 拒绝 |
|---|---|---|---|
| `session/open` | `{ sessionId }` | `{ traceId }` | `estela/unknown-session`：dsh 没有这个 id 对应的已存储会话。`estela/no-log`：该会话在磁盘上没有文件。`estela/failed`：无法对该文件做 stat，或者 dsh 拒绝该会话的格式（3.3.3）。 |
| `trace/view` | `{ traceId }` | `TraceViewResult` | `estela/unknown-trace`。`estela/stale`：该 id 签发之后日志发生了变化（3.3.3）。`estela/failed`：加载失败；`message` 来自存储层，已经脱敏。 |
| `trace/event` | `{ traceId, id }` | `EventDetail` | `estela/unknown-trace`。`estela/stale`。`estela/failed`。 |

- 每个端点还在这些情况下拒绝：输入不符合 schema 时是 `estela/bad-request`；对等方的 principal 不是 `owner` 时是
  `estela/forbidden`（T12）；插件被处置时仍在运行的那个调用得到 `estela/closed`。卸载之后发起的调用到不了 handler：
  dsh 回答 405（A2，第 6 节）。`details` 始终是 `{}`。
- handler 用一个 `try` / `catch` 包住整个分发：异常变成 `estela/failed`，消息固定为
  `"the session could not be read"`。可能含路径的消息只来自存储层，存储层在消息离开之前已经脱敏（`trace-store.ts` 的
  `guard` 和 `scrub`）。无法 stat 的文件也用固定的消息。插件自己组织的消息只有 3.3.3 的未知格式代次消息，它经过
  `core.redact` 脱敏。
- `sessionId`、`traceId` 和 `id` 是 1 到 256 个字符、不含控制字符的字符串。这里没有 dsh 会话 id 的语法文档，所以 schema
  不再收窄。
- 结果不在浏览器里再次解析：两个半边在同一个包里，值由 host 产出（`TraceViewResult`，
  `packages/rpc/src/trace-store.ts:62-69`；`EventDetail`，`:72`）。
- client 把错误码映射到元素的状态：`estela/no-log` 映射为 `NoLogError`，`estela/stale` 映射为 `StaleError`；其他所有
  拒绝映射为一次带 `message` 的失败加载，`parseFailure` 把这个 message 拆成代理、文件、行号和原因
  （`load-session.ts:38-44`），所以 DSH-5 像今天一样根据原因显示未知格式代次的提示
  （`workspace/error-panel.tsx:45`）。

#### 3.3.3 从会话到日志文件再到 trace id（`src/host/sessions.ts`）

```text
session/open(sessionId)
  snapshot = ctx.sessionPersistence.stat(sessionId)
  undefined                           -> estela/unknown-session
  throws a format refusal             -> estela/failed, the unknown-generation message
  no location                         -> estela/no-log
  info = core.platform.fs.stat(location.path)
  undefined or an exception          -> estela/failed
  traceId = traceIdOf({ agent: 'dsh', path: location.path, sessionId: `${info.size}:${info.mtimeMs}` })
  issued.set(traceId, { key: traceId, target: { path: location.path }, stamp: info })   // `resolve` reads this map
  keep the 16 most recently issued ids
  -> { traceId }
```

- trace id 在线上传输时不透明，并在文件的大小或修改时间变化时改变，所以之后再打开会重新读取日志，没有变化时则来自缓存
  （DSH-9）。文件被改写但大小相同、又落在同一个时间戳粒度之内，这种变化不会被发现。
- host 保留最近签发的 16 个 id，多于存储层缓存的 3 个快照。更早的 id 以 `estela/unknown-trace` 拒绝，client 像显示任何
  失败的调用一样显示它。不能仅仅因为存储层尚未缓存某个键就丢弃它：仍在进行中的加载之后需要它才能解析。
- 在 `trace/view` 或 `trace/event` 为一个存储层已不再缓存的 id 重新读文件之前，host 先对文件做 stat，并与标记比较。大小或
  修改时间不同就回答 `estela/stale`，丢弃该 id，什么也不读：屏幕上的事件列表属于旧快照，从已经变化的日志里读出的
  事件不属于它。随后 client 重新调用 `session/open`（3.4.1）。一个测试让某个 id 被另外三个会话淘汰，改动文件，
  再请求一个事件。
- 为把 `traceId ↔ 文件戳` 建成存储层不变量以覆盖各类竞态（冷重载、并发等待、取消后的重载，以及 `open` 与 `view`
  之间的缓存淘汰），`resolve` 把签发时的文件戳作为 `ResolvedSession.expect` 附上。`TraceStore` 在 `entryOf` 之后、
  `remember` 之前重新对 `target.path` 做 stat，戳不一致时拒绝缓存并抛出 `SnapshotChangedError`；host 将
  `SnapshotChangedError` 映射为 `estela/stale` 并作废该 id。对于已缓存的 `trace/event`，当原记录无法回读
  （`originalUnavailable`）且源文件戳已变化或文件已不存在时，host 同样返回 `estela/stale` 并作废该 id；文件未变时则
  保留 `originalUnavailable`。
- dsh 的持久层可能在 Estela 的读取器看到文件之前，就拒绝一个它读不了的格式代次的会话：`stat` 抛出
  `SessionFormatUnsupportedError`，它的消息已经带有原因和路径（`session-persistence/src/errors.ts:111-121`、
  `session-persistence-jsonl/src/index.ts:496`、`:1204`）。`session/open` 捕获它，用一个作用在 `name` 上的 `zod/mini`
  schema 检查这个错误，然后回答 `estela/failed`，消息与 kit 会给出的一样：`dsh: <path>:1: unknown format generation:
  <reason>`，其中路径和原因都经过 `core.redact`。所以在真实的路径上，DSH-5 同样显示格式原因和 issue 链接。一个测试用
  假的 `ctx.sessionPersistence` 抛出这样的错误，并断言消息和脱敏结果。
- 不检查 `location.kind`：kit 的读取器从文件本身识别格式，遇到不认识的格式会明确报错。

#### 3.3.4 加载与持有

- `trace/view` 用 `core.store.open(traceId)` 取一份持有，不传 owner，等待 `handle.done`，并在 `finally` 里释放持有。如果
  调用的 `signal` 先触发，持有立即释放；最后一个持有者释放会中止加载（`TraceStore.hold`，`trace-store.ts:395`）。然后它
  返回 `core.store.view(traceId)`。
- `trace/event` 调用 `core.store.event(traceId, id)`。它使用已缓存的条目，或者自己取一份持有（`TraceStore.entryFor`，
  `trace-store.ts:323`）。

#### 3.3.5 脱敏

core 通过 `present` 脱敏（`packages/server/src/store/trace-store.ts:76`），它覆盖视图 trace、事件和存储层的错误消息；对插件
自己组织的那一条消息（3.3.3），core 以 `core.redact` 提供同样的脱敏。插件不返回其他任何含有会话内容的东西，它的其他
消息都是固定字符串（T12）。dsh 所在环境里的 `ESTELA_REDACT=0` 会关闭脱敏，与开发服务器相同。

### 3.4 dsh 适配器：client 半边

#### 3.4.1 对话 View

- `src/client/index.ts` 是 factory 的函数体。`inject` 是 `['slots', 'connection', 'theme', 'locale']`，`dsh.client.inject`
  列出 `@deepseek-ai/dsh-client-ui-theme` 和 `@deepseek-ai/dsh-client-locale`；`slots` 和 `connection` 是 shell 自己的行。
  `apply` 调用 `defineEstelaWorkspace()`，并在 `ctx.effect` 里注册 slot 条目，做法与 dsh 的 Statistics 插件相同。
- slot 条目是 `{ name: 'conversation.view', id: 'estela', order: 60, label: 'Estela', inject: sessionId =>
  ({ sessionId }) }`。`order: 60` 使标签页排在 Trajectory 之后（A2，第 3 节）。
- 它的组件（`src/client/estela-view.ts`，按 T17 不写 JSX；上下文类型在 `src/client/types.ts`）渲染一个作为容器的
  `div`，并通过 ref 在里面渲染 `<estela-workspace>`，每个 `sessionId` 只设置一次 `source`（`src/client/source.ts`）。
  这个 source 的 `open` 每次都为当前的 `sessionId` 调用 `session/open`，再用它返回的 id 调用 `trace/view`；被拒绝时以
  映射后的错误拒绝。`event` 用元素传入的 trace id 调用 `trace/event`。所以「重试」和快照过期都会重新打开会话，而不重挂
  View（3.2.1）。
- 容器的高度（T25，`src/client/view-height.ts`）：批次 7 在 dsh 0.2.2-rc.5 实测确认，dsh 的 View 区域（位于
  `overflow-y: auto` 滚动容器内的 `flex: 1 0 auto`）不给元素定高，不加处理时元素会撑到 4410 px（导致账本虚拟滚动失效），
  且被 128 px 的 sticky 输入框浮层盖住账本与检查器底部。因此通过 `ResizeObserver`（配合滚动容器子节点的
  `MutationObserver`）把容器高度设为最近的纵向滚动祖先的 `clientHeight` 减去其中底部浮层的高度。

#### 3.4.2 外观

`src/client/appearance.ts` 把 `ctx.theme.getTheme().active.colorScheme` 映射为 `data-theme`，把
`ctx.locale.getLocale().active` 映射为 `lang`（`zh` 映射为 `zh-CN`，其余映射为 `en`，规则同
`apps/web/src/i18n/locale.ts:36-43`），并把 dsh 实时的 `--dsw-*` / `--ds-*` 令牌（优先读取
`snapshot.active.tokens` 里的主题覆写，其余通过 `var(--dsw-...)` 动态引用，不硬编码色值）写入
`<estela-workspace>` 的 `--estela-host-*` 自定义属性（背景、次级/检查器表面、选中芯片底色、悬停底色、边框、文字层级、
链接与选中强调色、错误色、正文字体族与等宽字体族、控件圆角）。某个宿主变量不存在时，CSS 自动回退到 `:host` 自带的
Estela 配色。它在 `ctx.effect` 里订阅 `ctx.on('theme/change', ...)` 和 `ctx.on('locale/change', ...)`，销毁时清除
`--estela-host-*` 属性，从不写 `document.documentElement`。标签页名「Estela」是产品名，不翻译。

### 3.5 包、清单与构建产物

#### 3.5.1 清单与文件

```json
{
  "name": "@rivus/dsh-estela",
  "description": "Estela view of the current DeepSeek Harness session: ledger, Model saw, Compare, and cost.",
  "license": "GPL-3.0-only",
  "type": "module",
  "private": true,
  "engines": { "dsh": ">=0.2.2-rc.5 <0.3.0-0", "node": ">=24.9.0" },
  "exports": {
    ".": "./dist/host.mjs",
    "./client": "./dist/client.js",
    "./icon": "./assets/icon.png",
    "./package.json": "./package.json"
  },
  "files": ["dist/host.mjs", "dist/client.js", "cordis.patch.yml", "dist/THIRD-PARTY-NOTICES.txt", "assets", "README.md", "LICENSE", "CHANGELOG.md"],
  "dsh": { "manifestVersion": 1, "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-theme", "@deepseek-ai/dsh-client-locale"] } }
}
```

- `cordis.patch.yml` 随 tarball 发布，内容是 `- insert: [{ id: estela, name: '@rivus/dsh-estela' }]`。没有它的包能安装，
  但无法激活。`src/package.test.ts` 对包执行 pack，并检查得到的包里有 `dsh.bundle.patch` 指向的那个文件。
- `"private": true` 保持到批次 10（T23）。
- `publishConfig.access` 是 `public`；`repository` 指向本仓库并带 `directory: "apps/dsh-plugin"`，收录建立 npm 关联需要它。
- `assets/icon.png` 是由 `docs/assets/logo.svg` 制作的方形位图。`README.md` 说明如何安装、视图显示什么、它的限制和许可证；
  它是 dsh 的 Plugins 页面的详情页。
- `package.json` 没有 `bin`、没有 `dependencies`，也没有 `peerDependencies`（T20）。dsh 的 client 包是固定在
  `0.2.2-rc.5` 的 devDependency，只用于类型，另有 `@types/react` 18。

#### 3.5.2 构建产物

- `vite.config.ts` 用 `vp pack`，入口是 `host`（`src/host/index.ts`，以 Node 24 为目标，`failOnWarn`，带 notices 插件）。
- `scripts/build-client.mjs` 一次性打包 `src/client/index.ts`，把 `react` 和 `react/jsx-runtime` 留作 `require(...)`
  调用，元素连同其样式表取自 `@rivus/estela-web/embed`，然后写出：

```js
window.__ModuleLoader__.load({
  id: '@rivus/dsh-estela',
  factory(require) {
    /* the bundle */
    return { inject, apply }
  },
})
```

  `apps/web` 下的文件用 `vite-plugin-solid` 编译；client 半边没有 JSX（T17）。一个测试在 Node 的 `vm` 上下文里加载
  `dist/client.js`，配上假的 `window.__ModuleLoader__` 和假的 `require`，检查注册的模块有 `inject` 和 `apply`。
- 一个测试列出构建出的 `dist/host.mjs` 的每一个 import 说明符（静态和动态都算），断言其中既没有 `devframe`，也没有
  `node:sqlite`。`node:sqlite` 只会经由会话索引进入包，而会话索引由会话目录打开；core 不导入会话目录（3.1.2），插件
  也不运行它。
- 插件不定义全局变量。自定义元素的名称在页面的整个生命期里保持已注册，包括插件被移除之后；这是浏览器的规则，不保存
  任何数据。

#### 3.5.3 插件拥有并回收的资源

dsh 会移除通过 `ctx` 注册的东西：通道、slot 条目、主题和语言的订阅。插件另外拥有两样东西，并在它的处置函数里回收：
core（释放持有），以及每个元素对应的那份 document 级 `<style>`（随最后一个元素移除）。

### 3.6 层次、lint 与工具

- `AGENTS.md` 的 Layers 表：为 `apps/dsh-plugin`（`@rivus/dsh-estela`）加一行：它负责 dsh 的 host 半边、client 半边、
  清单和两个构建产物；它可以依赖 `server`（其 `core` 入口）、`web`（其 `embed` 入口），以及 `rpc`、`schema` 和
  `@rivus/agent-kit` 的类型。`packages/server` 一行加上 `createEstelaCore` 和 `core` 入口；`apps/web` 一行加上 `embed`
  入口。
- `AGENTS.md` 的规则：入口点那条规则为插件写明 `createEstelaCore`；「RPC 绑定是模块状态」那句话
  （`docs/architecture/overview.md` 的「服务器组装」一节里也有）被替换。
- `scripts/check-layers.mjs`：`ALLOW['@rivus/dsh-estela'] = [SERVER, WEB, KIT, RPC, SCHEMA]`。
- 根 `vite.config.ts`，三条覆盖规则和一条已经适用的规则：
  - `apps/dsh-plugin/src/host/**`：不导入 `devframe`，也不导入 `@rivus/estela-server` 的根入口。
  - `apps/dsh-plugin/src/client/**`：运行时不从 `src/client/**`、`src/contract/**` 和 `@rivus/estela-web/embed`
    之外导入任何东西。
  - `packages/server/src/core/**`：不导入 `devframe`，也不从 `packages/server/src/catalog/` 导入。
  - 现有的「kit 只用于类型」规则已经覆盖 `apps/dsh-plugin`，因为它只排除 `apps/cli/**` 和 `packages/server/**`
    （`vite.config.ts:79`）。
- `knip.ts`：`'apps/dsh-plugin'`，配 `project: projectWithout(['scripts', 'test'])`，与 `apps/cli` 相同。
- `scripts/third-party-notices.ts` 从 `apps/cli/scripts/` 移到 `scripts/`，因为两个打包配置都要用它。

### 3.7 发布与文档

- 包在批次 10 之前是 `private: true`。没有 changeset 可以写一个 private 包的名字，而且每次推送到 `main`，发布 workflow
  都会去 npm 上查一个没有版本的公开包。所以批次 10 在同一个 pull request 里把插件改成 public，并完成 npm 首发、发布
  检查、接口文档和第一份 changeset（T23）。`.changeset/config.json` 不变。
- 从那以后，改变插件所提供内容的 pull request（`apps/dsh-plugin/`、`apps/web/`、任何 `packages/`）带一份写明
  `@rivus/dsh-estela` 的 changeset；改动在 `apps/web/` 或 `packages/` 下的，两个已发布的包都写上，就像今天改动被打包的
  包时要写上 CLI 一样。`CONTRIBUTING.md`（Release Intent、Bot Pull Requests）写明这一点。
- `.github/workflows/publish.yml`：
  - `check-command` 变为 `pnpm -C apps/e2e run test:smoke && pnpm --filter '@rivus/dsh-estela...' run build`。dsh 冒烟
    留在 CI 里，CI 会在版本 pull request 上运行。
  - `audit-command` 加上过滤条件 `'@rivus/dsh-estela...'`。
  - dry-run job 构建插件，并把 `pnpm --filter @rivus/dsh-estela pack` 的产物与 CLI tarball 一起保存。
- `docs/reference/public-interface.md` 在 Covered 下增加一节「dsh plugin (`@rivus/dsh-estela`)」：包名、安装和卸载命令、
  标为「Estela」的标签页、`engines.dsh` 范围、`ESTELA_REDACT=0` 的效果，以及插件没有配置。它的版本策略是 CLI 的 0.x
  策略；收窄 `engines.dsh` 范围属于破坏性改动，在 minor 版本中发布。「Not covered」加上插件的通道、元素和包内的文件。
  `docs/architecture/overview.md` 的兼容性一节删掉关于公开 `@rivus/estela/server` 入口的那句话。
- `scripts/check-release-intent.mjs`：改动行落在插件那一节之内的，需要一份发布 `@rivus/dsh-estela` 的 changeset；落在
  文件其他位置的，需要一份发布 `@rivus/estela` 的 changeset；两个区域都改的，两份都要。它读取
  `git diff --unified=0` 的各块范围，并为每个范围找到最近的上级标题。
- `docs/guide/dsh-plugin.md` 及其中文阅读版：安装、视图显示什么、会话必须已经开始、快照的限制、脱敏、卸载和版本范围。
  `docs/guide/README.md` 链接它，`docs/guide/troubleshooting.md` 增加一条「dsh 说插件不兼容」。
- `docs/development/setup.md`：冒烟命令和 CI job；验收表加上 DSH-1 到 DSH-14。
- 每份改动的英文文档都在同一个 pull request 里更新它的 `.zh-CN.md` 阅读版。

### 3.8 安全与隐私

- 通道通过 `ctx.connection` 注册，所以每次调用都先经过 dsh 的准入（A2，第 5 节）。随后 handler 拒绝 principal 不是
  `owner` 的对等方（T12）。插件不添加自己的路由。
- 日志在 dsh 的进程里读取，只发送到 dsh 的页面。不写入任何内容。
- 会话内容由工作区以文本绘制，与 CLI 相同；插件不添加自己的渲染。
- `client.js` 不需要 cookie 即可获取，与每个插件包相同。它只有代码。

### 3.9 冒烟测试与 CI

- `apps/dsh-plugin/test/dsh.smoke.ts` 在 `vp test` 下运行，脚本是 `test:smoke`，不属于 `pnpm test`。它打包插件，用
  `npm i --prefix <tmp> @deepseek-ai/dsh@<version> --registry https://registry.npmjs.org/` 安装一个固定版本的 dsh
  （文件里的 `DSH_VERSION = '0.2.2-rc.5'`），把 `DSH_HOME` 设为一个临时目录、`HOME` 设为一个假目录，再从该前缀在
  loopback 上启动 `dsh web`，不配置模型 key。它关掉全新 `DSH_HOME` 的两个弹窗（A2，第 3 节），用 Playwright 操作页面，并在
  `afterAll` 里停掉 dsh。`ESTELA_DSH_VERSION` 可以为 canary 运行覆盖版本。
- 会话按 A2 的 seed（第 3 节）放进临时 `DSH_HOME`。`test/seed-session.mjs` 对 `fixtures/sessions/dsh/conformance/plain`
  应用这个做法：头放在一个 zstd 帧里，事件放在另一个帧里；加一个 `turn/start`（conformance fixture 都没有它，所以只用
  它们播种的会话仍是空白的）；把序号改成连续的；并在 `storages/workspace.json` 里按工作区路径登记会话 id。一条用户消息被换成
  假的主目录路径，供 DSH-10 使用。冒烟先断言播种出的会话上出现了 Estela 标签页，再测试内容。
- seed 还为 DSH-7 写一个大会话：在 `turn/start` 之后把 fixture 的事件重复很多次，序号保持连续。插件加载它的时候，冒烟
  发一个由 dsh 自己处理的请求，并记录它的延迟。`DSH_LOAD_STALL_MS` 与 `DSH_VERSION` 放在一起，取这次测得的数值再加上
  其他时间预算所有的余量；超过它冒烟就失败。发 dsh 的哪个请求，要到第一次运行才能确定；读会话列表是候选。压不到这个
  上限之内的加载需要 worker，在它自己的 issue 里设计。
- 一个单元测试断言 `package.json` 里的 `engines.dsh` 从 `DSH_VERSION` 开始，这样范围与被测试的版本不会各走各的（D2）。
- 场景：DSH-1、DSH-2、DSH-3（一个新会话：没有标签页，没有名为 estela 的命令）、DSH-6（View 挂载期间的一次传输失败）、
  DSH-7、DSH-10、DSH-11（启动前用 `cordis.patch.yml` 选定浅色和中文）、DSH-12（在 `dsh web` 运行时执行 `remove`：通道
  回答 405，标签页消失；dsh 进程前后监听的套接字；profile 的 `package.json` 和 `node_modules`）、DSH-13（重新打包的、
  `engines.dsh: ">=99"` 的 tarball 被拒绝并以 1 退出；已安装副本声明了该范围的 profile 启动后没有该标签页）、DSH-14
  （不带 cookie 是 401；另一个 `Origin` 是 403）。
- `.github/workflows/ci.yml` 在 `test` 和 `platforms` 之外增加一个 job `dsh-plugin`：`ubuntu-latest`，Node.js
  `^26.13.1`，30 分钟，对其余 job 相同的 pull request 条件，步骤为 `pnpm --filter @rivus/estela-web run build`、
  `npx playwright install --with-deps chromium`、`pnpm -C apps/dsh-plugin run test:smoke`。该 job 也在 `schedule`
  （每周）和 `workflow_dispatch` 上运行，使用 dsh 的 `latest` 标签；这些运行不是必需的检查。
- `test` job 在预算步骤之前构建插件（3.10）。

### 3.10 预算

`scripts/budgets/budgets.mjs` 增加 `dsh-client-raw`、`dsh-client-gzip`（`dist/client.js`）、`dsh-host`
（`dist/host.mjs`）和 `dsh-tarball`（`apps/dsh-plugin` 的 `pnpm pack`），全部 `enforced: true`、`unit: 'bytes'`。它们的
上限未确定：批次 9 按文件开头的规定，把每一项设在首次测量值之上约 20 % 的位置。`scripts/budgets/sizes.mjs` 测量它们，
`test` job 在 `node scripts/check-budgets.mjs` 之前运行 `pnpm --filter '@rivus/dsh-estela...' run build`。

### 3.11 收录

- 人工步骤，owner：给仓库加上 `dsh-plugin` topic。
- 条目文件是 awesome-dsh-plugin 里的 `data/plugins/PerfectPan__estela--apps-dsh-plugin.yml`。仓库标识是
  `PerfectPan/estela`（`apps/cli/package.json:9`，即 `origin` remote），所以 spike 报告的名称不一致已不存在。
- 建议的内容见附录 B。描述只说 Spec 0010 要求的内容。
- 与列表里已有会话查看器的区别，依据它们在列表里的描述（没有读它们的代码）：`dsh-session-lazy-view` 是一个会话列表，
  只解压每个日志的尾部，并支持导出；Estela 没有会话列表，它读取当前会话的完整日志。`llm-capture` 在请求和响应发生时
  记录原始内容；Estela 不记录任何东西，它读取 dsh 已经写下的日志，所以对插件安装之前记录的会话同样有效。
  `dsh-llm-inspector` 调整 reasoning effort 并导出思考内容；Estela 不改变任何东西。`dsh-context-console` 创建、注入和修复
  会话消息；Estela 只读。
- 向 awesome-dsh-plugin 提交 pull request 是最后一步，需要 owner 确认。

## 4. 上线与稳定性

### 4.1 门禁与上线阶段

1. 本 Plan 经过审阅。
2. 批次 1 和 2 合入：命令行不变，由它的套件证明。
3. 批次 3 到 5 合入：CLI 不变，由它的套件证明；元素有自己的测试。
4. 批次 6 到 9 合入；`dsh-plugin` CI job 在固定版本的 dsh 上通过。此时包仍是 private。
5. 人工步骤：owner 在 npm 上发布 `@rivus/dsh-estela` 的占位版本，做法如 `CONTRIBUTING.md#publishing-to-npm` 对新包的描述。
6. 批次 10 合入：包变成 public，与接口文档和第一份 changeset 在同一个 pull request 里，所以推送到 `main` 会打开版本 pull
   request。
7. 人工步骤，在把版本 pull request 标为 ready 之前做：owner 配置 trusted publisher（GitHub owner `PerfectPan`、仓库
   `estela`、workflow `publish.yml`、不设 environment、打开「Allow npm publish」）。新的 trusted publisher 两天内没有发布
   就会过期。
8. 版本 pull request 合入；Publish workflow 发布插件。用 `npm view @rivus/dsh-estela` 和在一个临时 dsh profile 里的干净
   安装来验证。
9. owner 确认；打开收录的 pull request。

### 4.2 信号与告警

- 每个 pull request 上的 `dsh-plugin` job：固定版本的 dsh。
- 针对 dsh `latest` 的每周运行：运行变红意味着新的 dsh 版本破坏了插件或它的安装。随后 owner 修复插件，并以新的
  `engines.dsh` 范围发布（D2）。
- 每次发布之后的 `npm view @rivus/dsh-estela` 和 GitHub Release。

### 4.3 回滚

- 发布之前：回滚该批次的 pull request。没有数据被持久化，所以回滚是彻底的。
- 发布之后：`npm deprecate @rivus/dsh-estela@<version> "<reason>"`，必要时再执行
  `npm dist-tag add @rivus/dsh-estela@<previous> latest`。用户运行 `dsh plugin --profile web remove
  @rivus/dsh-estela`；不会留下任何东西（DSH-12）。npm 上的版本从不覆盖，也从不撤销发布。
- 命令行独立回滚：它的发布不依赖插件的发布。

## 5. 验证

### 5.1 功能检查

- `packages/rpc`：输入和 handler 的测试（`functions/handler-input.test.ts`、`functions/trace-view.test.ts`）改为针对工厂
  运行；新增一个测试，在两个存储层上各建一套函数，检查各自用自己的数据作答。
- `packages/server/src/core/estela-core.test.ts`：同一进程里的两个 core 读取不同的 fixture；core 既碰不到 DevFrame，也碰不到
  会话目录（构建出的 `dist/host.mjs` 的 import 说明符，3.5.2）。
- `apps/web/src/embed/*.test.ts`：样式表拆分（60 条 `@property` 规则，没有截断；embed 的样式表里没有 `@font-face`）；
  元素的主题和语言属性；「没有日志」；未知格式代次的提示和链接；没有返回链接、切换按钮和导出按钮；抛错的 source 显示
  「无法加载」；`open` 先拒绝一次再成功，元素没有被替换。
- `apps/web/src/workspace/workspace.test.tsx`：shell 的拆分（3.2.5）。
- `apps/dsh-plugin/src/host/*.test.ts`：用假的 `ctx` 测试每个端点的结果和拒绝（DSH-4、DSH-5、DSH-9、DSH-10、DSH-14）；
  被淘汰的 id 对应的文件变了时得到 `estela/stale`；dsh 自己拒绝格式时的未知格式代次消息；handler 内的异常变成
  `estela/failed`；使用 `rpc` 的 getter 调用。
- `apps/dsh-plugin/src/package.test.ts`：清单（`engines.dsh` 从 `DSH_VERSION` 开始，没有 `dependencies`，没有
  `peerDependencies`，exports 指向构建会写出的文件），以及打包出的包（`cordis.patch.yml` 是 `dsh.bundle.patch` 指向的
  那个文件）。
- `apps/dsh-plugin/scripts/build-client.test.ts`：`dist/client.js` 注册一个带 `inject` 和 `apply` 的模块。
- `apps/e2e/src/e2e/embed.e2e.ts`：在 A1 的 harness 页面上，用页面内的 source 在元素上跑 S7 和 CD-S1；宿主页的 URL 不变。

### 5.2 失败与重试检查

- `trace/view` 调用的 `signal` 触发时释放持有；作为最后一个持有者，它会中止加载。
- 未知格式代次、文件缺失和文件不可读，各自返回 `estela/failed`，带上存储层的消息或固定的消息（DSH-5）。
- 插件被处置时仍在运行的调用以 `estela/closed` 结束；卸载之后发起的调用从 dsh 得到 405，到不了 handler。
- 元素内部的渲染错误不影响页面和它的其他 View（DSH-6）；View 挂载期间的一次传输失败显示「重试」，重试会重新打开会话。

### 5.3 兼容性检查

- CLI：`cd apps/e2e && pnpm run test:smoke` 和 `pnpm run test:e2e` 不变。
- `node scripts/check-layers.mjs`、`node scripts/lint-scripts.mjs`、`pnpm lint`、`pnpm typecheck`、
  `node scripts/format.mjs --check`、schema 包的 `duplicates`、`knip` 和 `knip:production`。
- dsh：在固定版本上的冒烟测试；在 `latest` 上的 canary。

### 5.4 端到端验收

Spec 指派给 `dsh.smoke.ts` 的各个场景在那里通过，CI job 通过，其日志附在 pull request 上。

## 6. 执行计划

### 6.1 前置条件

- `@rivus/dsh-estela` 在 npm 上未被占用（2026-11-24 已核对）。
- 对批次 11：该包的占位版本和 trusted publisher（4.1，第 5 步和第 7 步）。

### 6.2 完成标准

| 场景 | 批次 | 证据 |
|---|---|---|
| DSH-1 | 8 | `dsh.smoke.ts` |
| DSH-2 | 3、4、5、7、8 | `dsh.smoke.ts`；`apps/e2e` S2、S7、CD-S1；`embed.e2e.ts` |
| DSH-3 | 8 | `dsh.smoke.ts` |
| DSH-4 | 4、7 | `apps/web/src/embed`；`src/host/channel.test.ts` |
| DSH-5 | 3、7 | `apps/web/src/embed`；`src/host/channel.test.ts` |
| DSH-6 | 5、8 | `embed.e2e.ts`；`dsh.smoke.ts` |
| DSH-7 | 4、8 | `apps/web/src/embed`；`dsh.smoke.ts` 记录阻塞时长 |
| DSH-8 | 8 | `packages/kernel/src/view.test.ts`；A2 第 2 节的测量 |
| DSH-9 | 7 | `src/host/sessions.test.ts`：变化的日志得到新的 id 并被重新读取；被淘汰的快照对应的文件变了，按过期拒绝 |
| DSH-10 | 7、8 | `src/host/channel.test.ts`；`dsh.smoke.ts` |
| DSH-11 | 3、7、8 | `apps/web/src/embed`；`src/client/appearance.test.ts`；`dsh.smoke.ts` |
| DSH-12 | 8 | `dsh.smoke.ts` |
| DSH-13 | 6、8 | `src/package.test.ts`；`dsh.smoke.ts` |
| DSH-14 | 7、8 | `src/host/channel.test.ts`；`dsh.smoke.ts` |

完成的含义：每个场景的测试存在并通过，5.3 的检查通过，3.7 的文档连同中文阅读版都已更新，并且插件的首个版本已发布。

### 6.3 执行顺序

批次 1 和 2 不需要其他前提。批次 3 和 6 可以彼此同时进行。批次 8 和 9 依赖批次 7。

#### 批次 0：server 前置项（已交付）

PR #172，以 `44cb909` 合入：`close()` 停掉摘要队列，`redacts` 是会话文本的唯一开关，`reportDir` 指定报告目录。批次 1
和 2 以合入后的结果为基础。

#### 批次 1：每实例一份 RPC 服务（`packages/rpc`、`packages/server`，一个 pull request）

- 文件：`packages/rpc/src/functions/{service,trace-view,report,list-sessions}.ts`、`packages/rpc/src/index.ts`、
  `packages/rpc/src/publish.ts`、`packages/rpc/src/functions/{handler-input,trace-view}.test.ts`、
  `packages/server/src/composition/{definition,estela-server}.ts`、`packages/server/src/catalog/session-catalog.ts`、
  `packages/server/src/report/report.ts`、`packages/server/test/export-report.test.ts`、
  `apps/cli/src/entry/commands/build.ts`、`apps/cli/test/report-build.test.ts`。
- 改动：3.1.1。`bind*` 导出和两个函数常量去掉；由工厂、发布器和报告 source 取代；`EstelaServer.writeReport` 取代自由的
  `writeReport`。
- 测试：现有的 handler 测试改为针对工厂运行；新增一个用例，在两个存储层上各建一套函数；会话目录通过 `announce`
  发布变更。
- 退出条件：`pnpm --filter @rivus/estela-rpc test`、`pnpm --filter @rivus/estela-server test`、`pnpm typecheck` 和 CLI
  冒烟通过；`grep -rn "bindTraceStore\|bindSessionService\|bindReportExporter\|bindReportSource\|bindSessionPublisher\|emitSessions" apps packages` 没有输出。
- 工作量：45 到 60 分钟。

#### 批次 2：不含 DevFrame 的 core（`packages/server`）

- 文件：`packages/server/src/core/estela-core.ts`、`packages/server/src/core/estela-core.test.ts`、
  `packages/server/src/composition/estela-server.ts`、`packages/server/src/store/trace-store.ts`、
  `packages/server/src/index.ts`、`packages/server/package.json`、根 `vite.config.ts`、`AGENTS.md`、
  `docs/architecture/overview.md` 及其 `.zh-CN.md`。
- 改动：3.1.2 和 3.6 的 lint 覆盖规则。服务构造从 `createEstelaServer` 移到 `createEstelaCore`；会话目录留在组装处，
  把它的解析器交给 core；加上 `./core` 入口；替换「绑定是模块状态」的那句规则说明。
- 测试：5.1 第二条。
- 退出条件：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`node scripts/check-layers.mjs` 和
  `node scripts/check-doc-translations.mjs` 通过；CLI 冒烟通过。
- 工作量：45 到 60 分钟。

#### 批次 3：`apps/web` 在 shadow root 里（`apps/web`）

- 文件：`apps/web/src/styles.css`、`apps/web/src/shell/{theme,top-bar}.ts(x)`、`apps/web/src/i18n/locale.ts`、
  `apps/web/src/i18n/dictionary.{en,zh-CN}.ts`、`apps/web/src/app.tsx`、`apps/web/src/shell/app-shell.tsx`（新增）、
  `apps/web/src/workspace/{workspace,error-panel,load-session}.ts(x)`、`apps/web/src/workspace/workspace.test.tsx`
  （新增）、`apps/web/src/workspace/inspector/inspector.tsx`、`apps/web/src/workspace/timeline/timeline.tsx`。
- 改动：3.2.2 的 A3、A4、A5、A9、B1 到 B6 各行和 B8，以及 shell 的拆分（3.2.5）。
- 测试：各改动文件旁边的单元测试，其中包括 `workspace.test.tsx`；CLI 的 Playwright 套件不变并通过，其中包括覆盖页面
  主题和语言的 S11 和 S14。
- 退出条件：`pnpm --filter @rivus/estela-web test`、`lint`、`typecheck` 和 `cd apps/e2e && pnpm run test:e2e` 通过。
- 工作量：45 到 60 分钟。

#### 批次 4：元素与 embed 构建（`apps/web`）

- 文件：`apps/web/src/embed/{index,estela-workspace,source,load-client,stylesheet}.ts`、
  `apps/web/src/embed/*.test.ts`、`apps/web/vite.config.ts`、`apps/web/package.json`、`.gitignore`。
- 改动：3.2.1、3.2.3、3.2.4；3.2.2 的 A1、A2、A6 和 B10 各行。加载路径（加载、就绪、各错误状态）在这里是新的，A1
  没有运行过。
- 测试：5.1 第三条和第四条。
- 退出条件：embed 测试通过；`vp build --mode embed` 写出 `dist-embed/`，并且构建出的样式表里没有 `@font-face`、有那 60 条
  `@property` 规则；CLI tarball 的文件列表不变。
- 工作量：60 分钟。

#### 批次 5：在浏览器里验证元素（`apps/e2e`）

- 文件：`apps/e2e/src/e2e/embed.e2e.ts`、`apps/e2e/src/e2e/harness.ts`，以及 `apps/e2e` 下的一个 harness 页面。
- 改动：A1 的 harness 页面，挂载 `dist-embed/` 并配一个页面内的 source；在元素上跑 S7 和 CD-S1；对 3.2.2 中标为「只读」
  的各行做检查（宿主页的 URL 不变）；抛错的 source（DSH-6）；缓慢的 source（DSH-7）。
- 测试：这个套件就是测试。
- 退出条件：`cd apps/e2e && pnpm run test:e2e` 带着新文件通过。
- 工作量：45 到 60 分钟。

#### 批次 6：包骨架、清单与层次（`apps/dsh-plugin`，仓库工具）

- 文件：`apps/dsh-plugin/{package.json,cordis.patch.yml,README.md,LICENSE,tsconfig.json,vite.config.ts}`、
  `apps/dsh-plugin/assets/icon.png`、`apps/dsh-plugin/src/contract/channel.ts`、
  `apps/dsh-plugin/src/package.test.ts`、`apps/dsh-plugin/scripts/build-client.mjs`、
  `apps/dsh-plugin/scripts/build-client.test.ts`、`AGENTS.md`、`scripts/check-layers.mjs`、根 `vite.config.ts`、
  `knip.ts`、`scripts/third-party-notices.ts`（移入）、`apps/cli/vite.config.ts`、`pnpm-lock.yaml`。
- 改动：3.5.1、3.5.2、3.6。该包构建出一个空的 host 入口和一个空的 client 入口，并通过所有仓库检查。
- 测试：5.1 的清单测试、打包产物的测试和构建产物测试。
- 退出条件：`node scripts/check-layers.mjs`、`pnpm lint`、`pnpm typecheck` 和两次 knip 运行通过；
  `pnpm --filter '@rivus/dsh-estela...' run build` 写出两个构建产物；`pnpm --filter @rivus/dsh-estela pack` 得到的包里
  有 `dsh.bundle.patch` 指向的那个文件；CLI tarball 的文件列表不变。
- 工作量：45 到 60 分钟。

#### 批次 7：host 半边与 client 半边（`apps/dsh-plugin`）

- host 的文件：`apps/dsh-plugin/src/host/{index,rpc,channel,sessions}.ts`、`apps/dsh-plugin/src/host/*.test.ts`。
  改动：3.3。测试：5.1 第五条；5.2。
- client 的文件：`apps/dsh-plugin/src/client/{index,estela-view,appearance}.ts`、
  `apps/dsh-plugin/src/client/appearance.test.ts`。改动：3.4。
- client 半边一开始先在 dsh 里做两项检查，每一项都在批次 8 里保留为一个冒烟场景：元素在 dsh 的 View 区域里的高度
  （T25）；带两个包的 `dsh.client.inject` 是否为第三方插件加载主题和语言服务。
- 退出条件：`pnpm --filter @rivus/dsh-estela test`、`lint`、`typecheck` 和 `build` 通过；`dist/host.mjs` 既不导入
  `devframe`，也不导入 `node:sqlite`。
- 工作量：两步，各 45 到 60 分钟。

#### 批次 8：冒烟测试与 CI job

- seed、大会话和阻塞时长的测量按 3.9 进行。
- 文件：`apps/dsh-plugin/test/dsh.smoke.ts`、`apps/dsh-plugin/test/seed-session.mjs`、
  `apps/dsh-plugin/package.json`（`test:smoke`）、`apps/dsh-plugin/vite.config.ts`、`.github/workflows/ci.yml`、
  `docs/development/setup.md` 及其 `.zh-CN.md`。
- 改动：3.9。
- 测试：冒烟测试就是测试。
- 退出条件：`cd apps/dsh-plugin && pnpm run test:smoke` 在本机对固定版本的 dsh 通过，并在 `dsh-plugin` job 里通过；运行结束
  之后没有残留的 `dsh` 进程，也没有残留的端口。
- 工作量：60 分钟。

#### 批次 9：预算与发布管线

- 文件：`scripts/budgets/{budgets,sizes}.mjs`、`scripts/check-budgets.mjs`、`.github/workflows/ci.yml`、
  `.github/workflows/publish.yml`、`scripts/check-release-intent.mjs` 及其测试、`CONTRIBUTING.md`。
- 改动：3.10，以及 3.7 中 workflow 和脚本的部分。
- 测试：`check-release-intent.mjs` 增加用例：改动在插件一节之内、在其他位置、两处都有。
- 退出条件：`node scripts/check-budgets.mjs` 打印四行新预算并通过；`gh repo-checks release-plan` 通过；Publish 的
  dry run 保存两个 tarball。
- 工作量：45 到 60 分钟。

#### 批次 10：公开、文档与第一批 changeset

- 文件：`apps/dsh-plugin/package.json`（去掉 `private`，加上 `publishConfig`）、`docs/reference/public-interface.md` 及其
  `.zh-CN.md`、`docs/guide/dsh-plugin.md` 及其 `.zh-CN.md`、`docs/guide/{README,troubleshooting}.md` 及各自的阅读版、
  `docs/architecture/overview.md` 及其阅读版、`README.md` 及其阅读版、`@rivus/dsh-estela` 和 `@rivus/estela` 的
  `.changeset/` 记录。
- 改动：3.7。包在这里变成 public，与接口文档和第一份 changeset 在同一个 pull request 里（T23）。
- 退出条件：`node scripts/check-doc-translations.mjs` 和 `gh repo-checks release-plan` 通过。
- 工作量：45 到 60 分钟。

#### 批次 11：收录（最后一步；需要 owner）

- 加上 `dsh-plugin` topic；owner 确认后，用附录 B 的条目打开 pull request。
- 退出条件：收录的 pull request 已打开（#109 的验收标准）。
- 工作量：30 分钟，外加维护者的审阅时间。

### 6.4 验证记录

| 批次 | 命令或证据 | 预期结果 |
|---|---|---|
| 1 | `pnpm --filter @rivus/estela-rpc test`；`pnpm --filter @rivus/estela-server test`；`pnpm typecheck` | 全部通过 |
| 1 | `cd apps/e2e && pnpm run test:smoke` | 原有场景通过 |
| 1 | 批次 1 的 `grep` | 没有输出 |
| 2 | `pnpm lint`；`pnpm test`；`node scripts/check-layers.mjs` | 通过 |
| 2 | `node scripts/check-doc-translations.mjs` | 通过 |
| 3 | `pnpm --filter @rivus/estela-web test`；`cd apps/e2e && pnpm run test:e2e` | 通过，e2e 不变 |
| 3 | A1 的截图对比，在合入后的页面构建上重跑 | 页面与 `main` 相差 0 个像素 |
| 4 | A1 的对比，元素由批次 4 构建，深色和浅色，九个场景 | 深色 0；浅色最多 46 个像素 |
| 5 | `cd apps/e2e && pnpm run test:e2e` | 通过，包含 `embed.e2e.ts` |
| 6 | `pnpm --filter @rivus/estela-schema run knip`；`run knip:production`；`pnpm --filter @rivus/dsh-estela pack` | 通过；包里有 `cordis.patch.yml` |
| 7 | `pnpm --filter @rivus/dsh-estela test`；`run build` | 通过；`dist/host.mjs` 的 import 说明符里既没有 `devframe`，也没有 `node:sqlite` |
| 8 | `cd apps/dsh-plugin && pnpm run test:smoke`；CI job `dsh-plugin` 的日志 | DSH-1 到 DSH-3、DSH-6 和 DSH-7 通过，DSH-10 到 DSH-14 通过 |
| 9 | `node scripts/check-budgets.mjs`；`gh repo-checks release-plan` | 通过 |
| 10 | `node scripts/check-doc-translations.mjs`；`gh repo-checks pr-body pr-body.md` | 通过 |
| 11 | 收录的 pull request | 已打开 |

### 6.5 每批的回滚方式

- 批次 1 到 10：每批一个 pull request；回滚它。没有数据被持久化，所以回滚是彻底的。批次 1 到 5 改变了 CLI 所提供的
  内容，各自带有针对 `@rivus/estela` 的 changeset，所以 CLI 可以不等插件就发布。
- 发布顺序：插件的首个版本需要批次 1 到 10。CLI 在批次 5 之后就可以发布。
- 批次 11：关闭收录的 pull request，或请列表的维护者移除条目。

### 6.6 分工与排期

| 批次 | 负责人 | 依赖 | 工作量 | 时间 |
|---|---|---|---|---|
| 0 | 已交付 | 无 | 已完成（`44cb909`） | 已完成 |
| 1 | unconfirmed | 0 | 45 到 60 分钟 | unconfirmed |
| 2 | unconfirmed | 1 | 45 到 60 分钟 | unconfirmed |
| 3 | unconfirmed | 无 | 45 到 60 分钟 | unconfirmed |
| 4 | unconfirmed | 3 | 60 分钟 | unconfirmed |
| 5 | unconfirmed | 4 | 45 到 60 分钟 | unconfirmed |
| 6 | unconfirmed | 2、3 | 45 到 60 分钟 | unconfirmed |
| 7 | unconfirmed | 4、6 | 2 × 45 到 60 分钟 | unconfirmed |
| 8 | unconfirmed | 7 | 60 分钟 | unconfirmed |
| 9 | unconfirmed | 7 | 45 到 60 分钟 | unconfirmed |
| 10 | unconfirmed | 7、npm 首发 | 45 到 60 分钟 | unconfirmed |
| 11 | owner | 首个版本发布 | 30 分钟，外加维护者的审阅时间 | unconfirmed |

工作量是一个 agent 完成一批的工作，包括它的测试；它不是承诺。

## 7. 风险、未决问题与后续事项

两项验证都没有覆盖的内容。每一行都写明在哪里解决。

| 事项 | 类型 | 影响 | 负责人 | 下一步或期限 |
|---|---|---|---|---|
| 一次加载阻塞 dsh 事件循环的时间超过冒烟上限（T10）。 | 风险 | 会话加载期间 `dsh web` 自己的请求被卡住。 | unconfirmed | 批次 8 测量它。压不到上限之内的加载需要 worker，在它自己的 issue 里设计。 |
| 元素在 dsh 的 View 区域里的高度（T25）。 | 已解决 | 事件列表塌陷，或者输入框浮层盖住检查器。 | 批次 7 | 已在批次 7 于 dsh 0.2.2-rc.5 实测：不加高度限制时元素撑到 4410 px 且被 128 px 的 sticky 输入框挡住，已由 `src/client/view-height.ts` 将容器高度设为最近纵向滚动祖先的 `clientHeight` 减去底部浮层高度。 |
| 带两个包的 `dsh.client.inject`，以及第三方 client 插件能否使用 `ctx.theme`、`ctx.locale`。 | 已解决 | 主题和语言将不得不改为从 dsh 的 document 属性读取。 | 批次 7 | 已在批次 7 于 dsh 0.2.2-rc.5 实测：两个包均可注入 `ctx.theme`（`getTheme()` / `theme/change`）与 `ctx.locale`（`getLocale()` / `locale/change`）并正常触发实时更新。 |
| 元素的加载路径（加载、就绪、错误）。 | 未决问题 | A1 没有运行过。 | unconfirmed | 批次 4 的测试和批次 5 的套件。 |
| 浏览器取消时 handler 的 `signal` 是否触发。 | 未决问题 | 没人等待的加载会跑到结束，结果被丢弃。 | unconfirmed | 不触发也可以接受；在批次 7 里记下。 |
| dsh 处于候选发布阶段，其扩展点不承诺兼容性（D2）。 | 风险 | 某个 dsh 版本可能破坏通道调用、View 或包格式。 | unconfirmed | 固定版本的冒烟 job 和针对 `latest` 的每周运行。 |
| `rpc` 的 getter 调用（T11）。 | 风险 | 它依赖 `rpc` 是服务原型上的 getter。 | unconfirmed | `src/host/rpc.ts` 里的回退；冒烟 job。 |
| `client.js` 在 dsh 每次页面加载时加载：最多约 122 kB gzip（T18）。 | 风险 | 从不打开视图的用户也要下载它。 | unconfirmed | 3.10 的大小预算；等 dsh 加载额外文件的机制得到验证后再用第二个文件。 |
| 标签页未被选中时 View 仍保持挂载（pin）。 | 风险 | 加载过一次的会话在日志增长后仍留在屏幕上，直到重新加载或切换会话。 | unconfirmed | DSH-9 接受这一点；实时跟随是 #104。 |
| 改写后大小和时间戳都相同，变化被隐藏。 | 风险 | 在下一次追加之前显示的是旧视图。 | unconfirmed | 接受；在 3.3.3 里记下。 |
| A1 只运行了 Chrome，而且只有模拟的宿主页。 | 风险 | 其他引擎或 dsh 的真实页面可能渲染得不同。 | unconfirmed | 冒烟 job 在 dsh 的真实页面上运行，使用 Chromium。 |
| dsh 内的「导出报告」。 | 后续事项 | 只安装插件的用户无法生成报告。 | unconfirmed | 需要在 dsh 里有保存位置、在别的进程里运行报告构建，以及静默的构建日志。 |
| dsh 内的会话浏览器。 | 后续事项 | 在 dsh 里无法访问其他代理的会话，空白会话也没有入口。 | unconfirmed | 需要验证一个 `conversation.view` 以外的入口。 |
| 用于冒烟测试的大型 dsh 日志。 | 后续事项 | DSH-8 由内核测试和 A2 的测量证明，而不是通过 dsh 里的插件。 | unconfirmed | 一个能生成指定大小 dsh 日志的生成器。 |
| dsh Desktop 和 TUI profile。 | 后续事项 | 不支持。 | unconfirmed | 验证 `dsh-app://`，以及 TUI 的一个页脚字段。 |

## 附录

### A. Spec 0010 所依赖的 dsh 行为

- 安装被拒绝，源码位置 `packages/boot/plugin-manager/src/operations.ts:351-356`、`:363-381`：诊断信息以
  `dsh: installation rejected:` 开头，接着是 `Plugin <name>@<version> is incompatible with dsh <version>:
  requirements {...}. Running it may cause crashes or data loss. ...`，点名 `dsh plugin allow-version`，并以
  `dsh: nothing was installed.` 结尾；退出码是 1。这些措辞属于 dsh，可能会变；DSH-13 检查的是拒绝和退出码，不是措辞。
- profile 启动，`packages/boot/app-boot/src/compatibility-preflight.ts:79-83`、`:101-117`：该行被置为 `disabled`，stderr
  得到 `dsh: disabling profile plugin <id>: <同样的诊断信息>`。
- 两处检查都调用同一个带 `includePrerelease: true` 的 `satisfies`
  （`packages/boot/app-boot/src/plugin-compatibility.ts:51-53`）。
- 空白会话没有 View 标签页：会话空白时 `DefaultConversationViews.tsx` 返回 `null`，而会话在 `turn/start` 之前都是空白的
  （`api/session-controller/src/list.ts:51`）。
- slot 条目不能选中 View：选中的 View 是 conversation store 的 `view`
  （`ui-conversation/src/client/skeleton/DefaultConversationViews.tsx:19-20`），只有随该 store 一起渲染的组件才能访问它的
  actions（`ui-conversation/src/client/apply.ts:457-460`）。dsh 自己的 sidebar-terminal 插件在
  `conversation.session.header.actions` 上挂载了一个返回 `null` 的组件；那里的条目收到的是标准的会话属性，不是 store。

### B. 建议的收录条目

```yaml
url: https://github.com/PerfectPan/estela/tree/main/apps/dsh-plugin
name: PerfectPan/estela#dsh-plugin
category: session
description:
  en: 'Adds an Estela view beside Chat and Trajectory that reads the current session log from disk: the ledger, what the model saw at a request, a context compare, what a compaction removed, and list-price cost.'
  zh: '在 Chat 和 Trajectory 旁增加 Estela 视图，从磁盘读取当前会话日志：账本、模型在某次请求看到的内容、上下文对比、上下文压缩移除的内容和按目录价计算的费用。'
icon: https://raw.githubusercontent.com/PerfectPan/estela/main/apps/dsh-plugin/assets/icon.png
```

描述会对照代码核查。提交 pull request 之前，必须对照已发布的插件重读一遍，并删掉发布版本不具备的任何说法。

### C. 否决的方案

- 用 iframe 嵌入 Estela 自己的 loopback 端口（phase 0 的设计）：多一个服务器、一个一次性码，以及一个可能到达会话日志的
  URL。已被 2026-11-19 的研究取代。
- 包名用 `@rivus/estela-dsh-plugin`：不符合列表的 `dsh-<name>` 模式（T1）。
- 公开的 `@rivus/estela/server` 和 `/embed` 入口：被 D3 否决。
- 靠 tree-shaking 把 DevFrame 从 `@rivus/estela-server` 里去掉，而不是设一个 `core` 入口：取决于打包器，也无法用 lint 约束
  （T6）。
- 第二个服务器绑定时抛出错误：已经没有剩下可绑定的东西（T5）。
- 在 rc.5 上直接写 `ctx.connection.rpc.handle(...)`：插件无法激活（T11）。
- 插件自己注册路由：在 rc.5 上可用，在 alpha.2 上回答 400，而且它的处置函数不与插件绑定（T11）。
- `engines.dsh` 从 rc.1 起：rc.1 到 rc.4 没有运行过（T11、T20）。
- 轮询的进度端点：每次加载最多只能画出几次更新，而且轮询没有测过（T10）。
- 用 `CSS.registerProperty` 取代 `<style>`：像素相同，代码更多（T19）。
- 在 embed 里带 web 字体并给族名加前缀：每次 dsh 页面加载多约 120 kB gzip，还要往宿主页的字体命名空间里加一个名字（T19）。
- 首次打开视图时再加载第二个文件：dsh 加载它的机制没有验证过（T18）。
- 首版里做会话浏览器和空白会话的入口：入口未经验证，还要再加一个界面（T15）。
- 首版里做 `/estela` 命令：rc.5 上没有能从命令选中 View 的接口。以后再加是纯新增（T16）。
- 把 CLI 和插件放进同一个 changesets `fixed` 组：插件的版本会跟着与它无关的 CLI 发布走，而由 dsh 驱动的插件发布又会
  抬高 CLI 的版本。
- 把 dsh 作为 workspace 的 devDependency 供冒烟测试使用：每次安装都要装 1.3 GB（T21）。
