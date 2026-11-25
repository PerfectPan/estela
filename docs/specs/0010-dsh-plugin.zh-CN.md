> 中文阅读版。以英文原文 docs/specs/0010-dsh-plugin.md 为准。

<!-- source-blob: 779b0648f5427927ca0942fc4dffd7dee44fc2da -->

# Spec 0010：作为 dsh 插件的 Estela

## 状态

Draft

配套 Plan：[`docs/plans/0010-dsh-plugin.zh-CN.md`](../plans/0010-dsh-plugin.zh-CN.md)

## 问题与范围

Estela 从磁盘读取 DeepSeek Harness（dsh）的会话日志，但 dsh 用户要查看这些日志，必须离开 harness 再运行一条命令
（[issue #109](https://github.com/PerfectPan/estela/issues/109)）。本 Spec 定义一个 dsh 插件，在 `dsh web` 内部以 View 的形式
展示当前会话的工作区，与 dsh 自己的 Chat 和 Trajectory 视图并列：每一个请求、模型在某次请求看到的内容、两次请求的
上下文有何不同、上下文压缩移除了什么，以及这个会话的费用。

包括：把插件安装到 `web` profile；Estela 视图；视图的加载、空和错误状态；大会话；脱敏；主题和语言；卸载；谁可以读取
会话；以及 dsh 版本不在支持范围内时 dsh 的行为。

不包括：对运行中会话的实时跟随（[#104](https://github.com/PerfectPan/estela/issues/104)）；替代 Trajectory；时间视图；
`/estela` 命令；dsh 内的会话浏览器；「导出报告」；ATIF 和 OTLP 导出；Dim
（[#110](https://github.com/PerfectPan/estela/issues/110)）；dsh Desktop（未验证）；以及 TUI profile。

关于 dsh 自身行为的陈述，来自在 `@deepseek-ai/dsh` 0.2.2-rc.5 上做的两项验证，以及阅读其 tag 为 `dsh-v0.2.2-rc.5` 的
源码。每个场景都写明确认它的测试。

## 行为要求

### 安装与 Estela 视图

- 插件是 npm 包 `@rivus/dsh-estela`。用 `dsh plugin --profile web add @rivus/dsh-estela` 安装，用
  `dsh plugin --profile web remove @rivus/dsh-estela` 卸载。
- 插件自身没有配置。
- 插件不启动进程、不监听端口、不注册自己的 HTTP 路由。它在 dsh 自己的进程里读取会话日志，并通过 dsh 自己的连接把数据
  发给浏览器。
- Estela 视图始终显示对话当前显示的会话，从不显示别的会话。

**DSH-1：出现 Estela 标签页**

- 给定 `dsh` 的版本在支持范围内（DSH-13），并使用它的 `web` profile，
- 当用户运行 `dsh plugin --profile web add @rivus/dsh-estela`，然后启动 `dsh web`，
- 那么安装成功，并且一个已经开始的会话在 Chat 和 Trajectory 旁显示各个 View 标签页，其中一个标为「Estela」。

**DSH-2：Estela 视图显示当前会话的工作区**

- 给定 `dsh web` 中打开了一个会话，它在磁盘上的日志可以读取，
- 当用户选中 Estela 标签页，
- 那么视图显示这个会话的工作区：单行紧凑统计栏（含各项数字、目录价费用与「转到事件列表」按钮，支持 `⌘K` / `Ctrl+K`，不重复绘制
  Estela 独立顶栏与会话大标题）、时间线、事件列表，以及带「输入」「输出」「模型所见」「对比」「原始记录」标签页的检查器。
- 并且它显示的内容与 `estela` 命令行对同一个日志文件显示的相同：「模型所见」重建模型在所选请求处拥有的上下文，
  「对比」显示同一泳道上两次请求的上下文有何不同，包括两次请求之间被上下文压缩移除的事件。
- 并且视图填满 dsh 分配给 View 的区域，并在自身内部滚动。
- 并且它不提供「导出报告」按钮。

### 尚未开始的会话

**DSH-3：空白会话**

- 给定当前打开的会话是空白的（没有任何轮次开始），
- 当用户查看对话界面，
- 那么 dsh 不显示任何 View 标签页，因此也没有 Estela 标签页。这是 dsh 自身的行为；插件不在这个界面上添加任何内容，
  也不在这里提供任何命令。
- 要进入 Estela，用户需要开始这个会话，或者在 dsh 的会话列表里选中一个已经开始的会话。

### Estela 视图的状态

**DSH-4：没有日志的会话**

- 给定一个会话已经开始，但它的日志尚未写入磁盘，
- 当 Estela 视图打开时，
- 那么它显示提示「这个会话的日志尚未写入磁盘。」，不显示任何错误详情。
- 并且 `dsh web` 继续正常工作。

**DSH-5：无法读取的日志**

- 给定当前会话的日志无法读取：文件缺失或不可读、格式代次是 Estela 的读取器或 dsh 自己不认识的，或者解压后的大小超过
  上限，
- 当 Estela 视图打开时，
- 那么它显示「无法打开这个会话」和原因；错误指明代理、文件和行号时一并显示；并提供「重试」按钮。
- 并且当原因是一次未知格式代次时，它显示与命令行相同的提示：「该代理可能更改了日志格式。请更新 Estela，或提交包含
  代理名称、版本和原因行的报告：」，以及指向 `https://github.com/PerfectPan/estela/issues/new/choose` 的
  「在 GitHub 上报告」链接。
- 并且它不显示返回会话浏览器的链接，因为 dsh 内部没有会话浏览器。
- 并且 `dsh web` 继续正常工作：Chat、Trajectory 和会话本身不受影响。

**DSH-6：错误留在视图内部**

- 给定 Estela 视图挂载期间发生任何失败：对插件的调用失败（传输失败、调用被拒绝，或者调用进行中插件被卸载），或者
  工作区绘制时出错，
- 当该失败发生时，
- 那么 Estela 视图说明它无法加载这个会话，并提供「重试」。
- 并且失败留在视图内部：`dsh web` 不出现空白页，也不出现错误页，它的其他 View 继续工作。
- 并且「重试」重新请求会话，所以原因消除之后它会成功。视图不会被重新挂载。

### 大会话与运行中的会话

**DSH-7：加载**

- 给定会话日志需要一定时间才能读完，
- 当 Estela 视图打开时，
- 那么它显示「正在打开会话」和一个不显示进度的加载指示。
- 并且在会话加载期间，`dsh web` 的其余部分仍可使用：`dsh web` 自己处理的请求，比没有加载时最多多等约 N ms。N 是
  冒烟测试记录的数值。

**DSH-8：超过 12 MB 预算的视图**

- 给定某个会话在默认文本长度下，其视图放不进 12 MB 的视图预算，
- 当 Estela 视图打开时，
- 那么长字符串被截短到能放下的最长长度，与命令行的做法相同，并且视图显示「为了让视图保持在 12 MB 以内，长文本被截短到
  N 个字符。选中事件即可加载完整文本。」
- 并且选中一个事件会加载它的完整文本。
- 给定即使使用最短的文本长度视图也放不下，
- 当 Estela 视图打开时，
- 那么它仍然打开，并显示「即使使用最短的文本长度，这个会话仍超过 12 MB 的视图预算，页面可能较慢。」
- 并且选中一个事件仍会加载它的完整文本。

**DSH-9：仍在运行的会话**

- 给定会话仍在运行，并且它的日志在 Estela 视图加载之后有增长，
- 当视图在屏幕上时，
- 那么它继续显示加载时的日志。它不跟随会话。
- 当用户重新加载 `dsh web` 页面并再次打开 Estela 视图时，它显示当时磁盘上的日志。
- 并且它从不把日志的两个状态混在一起：某个事件已经无法从屏幕上的快照读到时，视图改为加载当时磁盘上的日志，
  而不是从已经变化的日志里显示这个事件。

### 脱敏

**DSH-10：脱敏**

- 给定启动 `dsh` 所在的环境里 `ESTELA_REDACT` 不是 `0`，
- 当 Estela 视图显示会话的任何部分（页头、时间线、事件列表、检查器文本、「原始记录」「模型所见」「对比」）或一条
  错误消息时，
- 那么主目录和[隐私](../guide/privacy.zh-CN.md#脱敏覆盖的范围)一节列出的令牌形式都会被替换，替换方式与 `estela`
  开发服务器相同。
- 给定该环境里 `ESTELA_REDACT=0`，Estela 视图显示未脱敏的记录文本。

### 主题和语言

**DSH-11：主题和语言跟随 dsh**

- 给定用户在 dsh 的外观设置里选择浅色、深色或跟随系统，Estela 视图使用该配色方案并承接 dsh 的表面、边框、文字、强调色和
  字体族令牌；视图打开期间设置发生变化时也一样。视图没有自己的主题切换。
- 给定用户在 dsh 里选择一种语言，Estela 视图对中文使用简体中文，对其他所有语言使用英文；视图打开期间语言发生变化时也
  一样。视图没有自己的语言切换。
- 在两种语言下，会话内容都按记录原样显示。

### 卸载

**DSH-12：卸载不留任何东西**

- 给定插件已安装，并且 `dsh web` 正在运行，
- 当用户运行 `dsh plugin --profile web remove @rivus/dsh-estela`，
- 那么几秒钟之内，已打开页面上的 Estela 标签页消失，无需重启，并且对插件通道的调用被拒绝。
- 并且插件没有任何东西留下：没有进程（它不启动任何进程）、没有监听端口、dsh 的 HTTP 服务器上没有路由，profile 的
  `package.json` 和 `node_modules` 里也没有它的条目。
- 并且再次安装插件可以成功。

### dsh 版本不在支持范围内

- 支持的 dsh 版本是插件 `engines.dsh` 字段里的范围。

**DSH-13：dsh 版本不在 `engines.dsh` 范围内**

- 给定正在运行的 dsh 不在该范围内，
- 当用户运行安装命令，
- 那么 dsh 在安装任何东西之前拒绝，以状态 1 退出，并在 stderr 上打印：该插件与正在运行的 dsh 版本不兼容、哪一项要求
  未满足，以及 `dsh plugin allow-version` 是为一个确切的插件版本在一个确切的 dsh 版本上接受风险的办法。
- 给定插件已经在 profile 里，而 dsh 不在范围内（dsh 被升级或降级过），
- 当 profile 启动时，
- 那么 dsh 在不加载插件的情况下启动，在 stderr 上打印一行说明它禁用了该插件及原因，并且 `dsh web` 不显示 Estela
  标签页。

### 谁可以读取会话

**DSH-14：只有 dsh 的 owner 能拿到会话内容**

- 插件的通道受 dsh 自身的准入保护，插件不替换它：不带 dsh cookie 的请求被拒绝（401）；带 cookie 但来自另一个来源或
  另一个 `Host` 的请求被拒绝（403）。
- 给定 dsh 以 owner 身份准入的对等方，凭浏览器 cookie 或者 dsh 启动 URL 签发的 API cookie，当它调用插件的通道时，
  那么它得到服务。
- 给定 principal 不是 `owner` 的对等方，当它到达插件的通道时，那么插件拒绝该调用，不返回任何会话内容。

## 领域不变量

- 插件从磁盘读取 dsh 当前显示的会话的日志，使用的是 `estela` 命令行所用的同一个 dsh 读取器。视图绘制的一切都在浏览器
  里根据这份日志计算，与命令行的工作区相同。
- 插件不向磁盘写入任何内容：不写会话日志，不写 dsh 的文件，也不写 Estela 的会话索引。
- 缺失的数据是 `unavailable`。不做估算，不做虚构。
- 浏览器用来指代已加载日志的 id 是不透明的。无法从中读出路径或 dsh 会话 id，路径也从不作为 id 经过通道。
- 会话内容是数据。它以文本绘制，从不作为标记语言。
- 插件自己创建的消息不含路径；可能含路径的消息来自存储层，存储层会先脱敏。
- 已加载的视图是日志在某一时刻的快照。

## 兼容性与约束

- 公开 API，自插件首个版本起覆盖：包名；安装和卸载命令；Chat 和 Trajectory 旁标为「Estela」的标签页；`engines.dsh`
  范围；`ESTELA_REDACT=0` 的效果；以及插件没有配置。不覆盖：插件的通道和端点名、`<estela-workspace>` 元素及其
  `source` 属性、包内的文件，以及各种提示的措辞。
- 持久化数据：无。
- 配置：本版本没有。
- 运行上限：12 MB 的视图预算（[视图 trace](../architecture/overview.zh-CN.md#视图-trace加载与重建)）；dsh
  进程的内存里保留最近打开的三个快照；一个压缩日志最多解压 512 MB；插件运行在 dsh 自己的 Node.js 进程里。
- Profile：支持 `web` profile。其他 profile（Desktop、TUI）未验证，也不支持。
- 插件跟随 dsh 的候选发布线。`engines.dsh` 之外的 dsh 版本需要一个带新范围的插件版本（Plan 中的决定 D2）。

## 验收证据

`dsh.smoke.ts` 指 `apps/dsh-plugin/test/dsh.smoke.ts`：它打包插件，把插件装进一个临时 `DSH_HOME`（其中固定一个 dsh
版本），在不调用模型的情况下启动 `dsh web`，并用 Playwright 操作页面。

| 场景 | 测试 |
|---|---|
| DSH-1 | `dsh.smoke.ts`（DSH-1） |
| DSH-2 | `dsh.smoke.ts`（DSH-2），使用由 `fixtures/sessions/dsh/conformance/` 播种出的会话；命令行的工作区测试保持不变（`apps/e2e` 中的 S2、S7、CD-S1），它们证明工作区本身；S7 和 CD-S1 在元素上再跑一遍（`apps/e2e/src/e2e/embed.e2e.ts`） |
| DSH-3 | `dsh.smoke.ts`（DSH-3），在一个新会话上 |
| DSH-4 | `apps/dsh-plugin/src/host/channel.test.ts`（DSH-4）；`apps/web/src/embed/estela-workspace.test.ts` |
| DSH-5 | `apps/dsh-plugin/src/host/channel.test.ts`（DSH-5），使用不可读的和未知格式代次的 dsh fixture，以及 dsh 自己拒绝格式的情况；`apps/web/src/embed/estela-workspace.test.ts` 检查提示、链接以及没有返回链接 |
| DSH-6 | `apps/e2e/src/e2e/embed.e2e.ts`，使用一个抛错的数据源和一个先拒绝一次的数据源；`dsh.smoke.ts`（DSH-6）：View 挂载期间的一次传输失败 |
| DSH-7 | `apps/web/src/embed/estela-workspace.test.ts`，使用一个缓慢的数据源；`dsh.smoke.ts`（DSH-7）记录 N |
| DSH-8 | `packages/kernel/src/view.test.ts`（`fitView`，已有）；Plan 中记录的测量，即 12 MB 的结果能通过 dsh 的通道 |
| DSH-9 | `apps/dsh-plugin/src/host/sessions.test.ts`（DSH-9）：变化的日志得到新的 id 并被重新读取；被淘汰的快照对应的文件变了，按过期拒绝 |
| DSH-10 | `apps/dsh-plugin/src/host/channel.test.ts`（DSH-10），`ESTELA_REDACT` 取两种值；`dsh.smoke.ts`（DSH-10），使用一个文本中含有临时主目录路径的播种会话 |
| DSH-11 | `apps/web/src/embed/estela-workspace.test.ts`（属性）；`apps/dsh-plugin/src/client/appearance.test.ts`；`dsh.smoke.ts`（DSH-11） |
| DSH-12 | `dsh.smoke.ts`（DSH-12）：dsh 进程前后监听的套接字相同 |
| DSH-13 | `apps/dsh-plugin/src/package.test.ts`（范围从测试过的 dsh 版本开始）；`dsh.smoke.ts`（DSH-13）：重新打包的、范围无法满足的 tarball 被拒绝；已安装副本声明了该范围的 profile 启动后没有该标签页 |
| DSH-14 | `apps/dsh-plugin/src/host/channel.test.ts`（不是 owner 的对等方）；`dsh.smoke.ts`（DSH-14）：不带 cookie 得到 401，另一个来源得到 403 |
