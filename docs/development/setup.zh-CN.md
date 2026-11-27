> 中文阅读版。以英文原文 docs/development/setup.md 为准。

<!-- source-blob: 70d353ccb5a3989f294fb72b61fdc8076761cae9 -->

# 开发

读者对象：在本地运行或测试查看器的开发者。

## 环境设置

```bash
gh extension install PerfectPan/gh-repo-checks
./scripts/install-git-hooks.sh
pnpm install
```

请使用 Node.js `^26.13.1`（26.x 中的 26.13.1 及以上版本）：根 `package.json` 会检查此开发运行时范围。构建出的 CLI 可在 Node.js 24 或更高版本上运行，并在 Node 版本过低时于加载前退出。

## 检查项

```bash
gh repo-checks repository
node scripts/check-doc-translations.mjs
node scripts/check-conventions.mjs
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
node scripts/check-release-intent.mjs
node scripts/format.mjs --check
node scripts/lint-scripts.mjs
pnpm lint
pnpm test
pnpm typecheck
pnpm --filter @rivus/estela-schema run duplicates
pnpm --filter @rivus/estela-schema run knip
pnpm --filter @rivus/estela-schema run knip:production
pnpm build
node scripts/check-budgets.mjs
```

### 性能与体积预算

`node scripts/check-budgets.mjs` 在 `pnpm build` 之后运行，并使用 `apps/cli/dist` 和 `apps/dsh-plugin/dist`。它在临时目录中生成数据并随后删除（设置 `ESTELA_BUDGETS_KEEP=1` 可保留）；不会向仓库提交任何生成文件。它测量以下指标：

- 首屏行耗时：包含 2,500 个 Claude Code 会话和 2,500 个 Codex 会话的合成主目录（约 190 MB，`scripts/budgets/synthetic-home.mjs`）。计时从启动 `dist/bin.mjs` 进程开始，到通过会话浏览器使用的同一 DevFrame 客户端收到首个包含全部会话的 `list-sessions({})` 响应为止。服务器只有在会话目录取得列表行后才开始监听，因此这一刻正是浏览器能够展示它们的时刻。冷启动没有索引；热启动复用冷启动在所有摘要完成后写下的索引，且如果 CLI 未报告行数据来自索引则判为失败。
- 大型会话：通过命令行传入由 `packages/server/src/testsupport/large-session.ts`（S12 生成器）生成的 100 MB Codex rollout 文件；计时持续到收到 `get-trace-view` 响应，峰值 RSS 取 CLI 进程的 `maxRSS`。
- 体积：网页打包产物的 JS 与 CSS 原始体积和 gzip 体积、`dist/cli.mjs` 体积、CLI 的 `pnpm pack` tarball 体积，以及 dsh 插件的 `dist/client.js`（原始体积与 gzip 体积）、`dist/host.mjs` 和 `pnpm pack` tarball 体积。

它会打印实测值与预算的对比表，在设置了 `$GITHUB_STEP_SUMMARY` 时将其追加到该文件中，并在任一强制预算超出时以 1 退出。各预算项、是否强制执行以及各项数字的依据均写在 `scripts/budgets/budgets.mjs` 中。使体积超出预算的 PR 需在同一个 PR 中上调该文件中的数字，并在依据和 PR 的 Validation 部分写明新测量值。CI 会在 `test` 作业的 tarball 冒烟步骤之后，基于该步骤的构建产物运行此检查。

## 运行界面

```bash
cd apps/cli
pnpm run dev
```

CLI 会携带一次性验证码打开浏览器，也可以打开终端中打印的 `#devframe_otp=` 链接。

不传入路径时，应用会打开涵盖所有已注册代理的会话浏览器。传入位置参数（或设置 `ESTELA_PATH`）时，会在服务器监听前加载该会话并打开 `#/s/<traceId>`。`--pick` 在终端中列出所有会话。`build` 仍默认使用 `fixtures/demo.trace.json`；不带路径的 `mcp` 服务于所有会话。

`fixtures/demo.trace.json` 是脚本生成的：一个虚构的、关于小型图书目录 API 的 Claude Code 会话（五个轮次、34 个带缓存 Token 计数的主请求、一次 `/compact`、两条子代理泳道、三次失败的工具调用、钩子以及提示词快照），由 `packages/server/src/testsupport/demo-session.ts` 写入并经由 kit 读取为规范 JSON。当提交的文件与生成器输出不一致时（例如升级 kit 之后），`demo-trace.test.ts` 会失败；此时使用以下命令重新生成：

```bash
node packages/server/src/testsupport/demo-trace.ts fixtures/demo.trace.json
```

用于演示和截图时，`apps/e2e/src/demo/demo-home.ts <dir>` 会创建一个包含该会话以及来自 Claude Code、Codex、Gemini CLI 和 Grok 的八个小型会话（共三个虚构项目）的主目录。`apps/e2e/src/demo/record-demo.ts` 会创建该主目录、在其上启动 `apps/cli/dist/bin.mjs`（需先运行 `pnpm build`），并向 `--out`（默认 `/tmp/estela-media`）输出 README 与展示截图及演练视频（MP4、WebM，以及短循环 WebP 和 GIF）。它需要 `PATH` 中存在 ffmpeg、`cwebp` 和 `img2webp`；`--help` 可查看所有输出产物。

`build <path> --out-dir <dir>` 将报告写出为单个 `<dir>/index.html`；可直接从磁盘打开。工作区中的「导出报告」会将相同文件写入服务器工作目录下的新 `estela-report-<traceId>-<time>/` 目录并显示路径。

会话索引位于 `$XDG_CACHE_HOME/rivus-estela/index.sqlite`，未设置 `XDG_CACHE_HOME` 时位于 `~/.cache/rivus-estela/index.sqlite`。它是一个缓存，可随时删除。`--no-index` 启动时不读写索引（此时搜索仅覆盖标题和首条提示词）。将 `HOME` 指向包含夹具会话的目录即可使用合成数据运行：

```bash
HOME=/tmp/estela-home node apps/cli/bin.mjs --no-auth --no-open
```

## 打包产物与 tarball

`pnpm --filter '@rivus/estela...' run build` 使用 `vp pack`（`apps/cli/vite.config.ts` 中的 `pack` 配置块）构建 `apps/cli`：

- `dist/bin.mjs` 是包的 `bin` 入口，由 `apps/cli/bin.mjs` 构建而成。它检查 Node.js 版本并屏蔽 `node:sqlite` 的 ExperimentalWarning，然后导入 `dist/cli.mjs`（从源码运行时，同一文件导入 `src/main.ts`）。
- `dist/cli.mjs` 打包了壳层、所有 `@rivus/*` workspace 包、`@clack/prompts` 和 `@bomb.sh/router`。`devframe` 和 `@devframes/agentic` 保留为外部依赖，作为该包仅有的两个运行时依赖。`@devframes/agentic` 声明了精确的 `devframe` peer dependency，因此两者保持相同版本。
- `dist/web/` 是 `apps/web/dist` 的副本，`dist/fixtures/demo.trace.json` 是 `build` 与各导出命令的默认会话。当 pack 配置定义了 `ESTELA_BUNDLE` 时，`src/paths.ts` 使用这些路径；从源码（`node bin.mjs`）运行时，则使用 workspace 中的 `apps/web/dist` 和 `fixtures/`。
- `dist/THIRD-PARTY-NOTICES.txt` 保存了打包进 `cli.mjs` 以及用于构建网页产物的 npm 包的许可证文本，其中包括经由 vite-plus-core 引入的 Vite 和 Rolldown；CLI 部分同样列出了 Rolldown，因为它提供了 `cli.mjs` 和 `bin.mjs` 中的运行时辅助代码（`scripts/third-party-notices.mjs`，一个 Rolldown 插件）。

```bash
pnpm --filter '@rivus/estela...' run build
cd apps/cli
node dist/bin.mjs --help          # the bundle, from the workspace
pnpm pack --pack-destination /tmp  # the tarball; `files` ships dist (with THIRD-PARTY-NOTICES.txt), README.md, LICENSE, CHANGELOG.md once versioned
```

`pnpm --filter '@rivus/dsh-estela...' run build` 将 DeepSeek Harness 插件构建为 `apps/dsh-plugin/dist/host.mjs`（`vp pack`）、`dist/client.js`（`apps/dsh-plugin/scripts/build-client.mjs`）和 `dist/THIRD-PARTY-NOTICES.txt`；`pnpm --filter @rivus/dsh-estela pack` 会将这些文件连同 `cordis.patch.yml`（dsh 激活插件所必需）和 `assets/icon.png` 一同打包。

`pnpm pack` 会把清单中的 `workspace:` 和 `catalog:` 说明符重写为实际版本号。`npm pack` 会保留它们，而 `catalog:` 协议会导致 npm 无法安装该 tarball。

切勿从本地检出目录直接发布。使用手动 Publish 工作流默认的 dry run 来构建并测试发布用 tarball，然后再上传至 npm（见 [`CONTRIBUTING.md`](../../CONTRIBUTING.md#publishing-to-npm)）。

## 验收场景

测试标题与注释使用这些 ID，以便通过测试名直观说明它验证哪项行为。`smoke` 指 `test:smoke`，`e2e` 指 `test:e2e`，两者均针对已安装的 tarball 运行。面向用户的具体行为说明见[用户指南](../guide/README.zh-CN.md)。

| ID | 行为 | 测试套件 |
|---|---|---|
| S1 | 在 Claude Code、Codex 和 Grok 的默认位置放入会话时，打开的 URL 列出全部三个代理的会话，并显示每个代理的计数 | e2e |
| S2 | `estela <path>` 打开该会话的工作区 | smoke、e2e |
| S3 | 主目录缺失的代理（没有 `~/.codex`）显示 0 个会话及检查过的路径；其他代理正常加载 | e2e |
| S4 | 处于未知格式代次的文件被列为「无法读取」；其工作区显示代理、文件和行号 | e2e |
| S5 | 请求柱条升高至标有压缩前后 Token 数的虚线上下文压缩标线处，并在其后变低 | e2e |
| S6 | 拖动时间线范围框或在聚焦手柄时用方向键移动，可过滤事件列表并标明时间范围和事件数 | e2e |
| S7 | 在上下文压缩后的首个请求处查看「模型所见」：各个槽位附带已记录的 Token 数，仅当该请求或之前存在提示词快照时才显示系统提示词和工具，并列出被移除的事件 | e2e |
| S8 | 在包含 10,000 个事件的 trace 上滚动时，渲染的行数少于 100 且没有超过 200 ms 的长任务 | e2e |
| S9 | 导出的报告可在无服务器情况下从 `file://` 打开，使用导出时语言，且不包含任何主目录路径 | e2e |
| S10 | `mcp` 列出其工具，`reconstruct` 返回可见 id、不可用槽位和完整性，且 stdout 只输出协议内容 | smoke、`apps/cli/test/cli-smoke.test.ts` |
| S11 | 主题跟随系统配色方案；手动切换在刷新页面后保持不变 | e2e |
| S12 | 350 MB Codex 文件在显示加载进度后打开，选中事件前到达浏览器的数据不超过 12 MB，选中被截短的输出时加载完整文本 | e2e、`packages/server/test/size-budget.test.ts`（需手动开启） |
| S13 | 在 Node.js 22 上运行 CLI 时打印一行提及 Node.js 24 的提示并以 1 退出 | smoke |
| S14 | `zh-CN` 浏览器获取中文标签与日期格式且会话内容保持不变；切换为英文在刷新页面后保持不变 | e2e |
| S15 | 将 `build` 管道输出到文件时，写入纯文本行，不含转义序列也不含主目录路径 | smoke |
| S16 | 在终端中运行 `--pick`：输入标题的一部分并按 Enter 打开该会话 | smoke |
| S17 | 不带路径运行 `mcp` 会列出带有命名输入属性的七个工具，并能依次串联列表、摘要、轮次、请求、重建和获取事件直至找到失败的工具结果（见 [MCP 工具](../guide/mcp.zh-CN.md)） | smoke、`packages/server/test/agent-tools.test.ts` |
| S18 | 在设置 `ESTELA_REDACT=0` 时，恶意会话上的 MCP 工具结果仍不包含主目录路径，也不按原样返回不安全 id（而是返回 `@e0`） | smoke、`packages/server/test/agent-tools.test.ts` |

上下文差异（「对比」标签页；见[工作区指南](../guide/workspace.zh-CN.md#对比)）：

| ID | 行为 | 证据 |
|---|---|---|
| CD-S1 | 跨越一次上下文压缩（压缩前 3.5k、压缩后 400），将压缩后的首个请求与压缩前的最后一个请求对比：输入 Token 为 `3k → 600` 与 `−2.4k`、显示一行上下文压缩记录 `3.5k → 400`、压缩摘要出现在进入上下文的事件中，且被上下文压缩隐藏的事件数与「模型所见」中列为被移除的事件数一致 | `compare.e2e.ts`、`packages/kernel/src/context-diff.test.ts` |
| CD-S2 | 最后一个请求默认与上一个请求对比（无上下文压缩、无隐藏事件）；点击「最近一次压缩之前」会选中压缩前的最后一个请求并显示一行上下文压缩记录 | `compare.e2e.ts`、`apps/web/src/lib/context-compare.test.ts` |
| CD-S3 | 按住 Shift 点击主泳道上的另一根请求柱条会将其设为对比目标，为其绘制虚线框，并保持当前选中状态不变 | `compare.e2e.ts` |
| CD-S4 | 日志未记录的槽位显示斜线底纹和 `unavailable` 且不列出变化；不同时具备双方的输入 Token 计数时不显示差值 | `compare.e2e.ts`、`context-diff.test.ts` |
| CD-S5 | 在使用提示词快照时，相同的已记录系统提示词在完整 trace 和视图 trace 上均显示为「相同」；列明增减的工具名称，或在定义没有名称时显示「未记录」；直到较早请求之后才首次记录的工具显示为 `unavailable` | `compare.e2e.ts`、`context-diff.test.ts` |
| CD-S6 | 请求与自身对比：无进入、离开或隐藏的事件，且有记录时输入 Token 差值为 0 | `context-diff.test.ts` |
| CD-S7 | 在从 `file://` 打开的报告中，「对比」给出相同的差异，且切换为中文会翻译所有标签 | `compare.e2e.ts` |
| CD-S8 | 在子代理泳道上，差异仅覆盖该泳道；选择器从不提供另一泳道的请求，且内核会以 `different-lanes` 拒绝跨泳道对比 | `context-diff.test.ts`、`context-compare.test.ts` |
| CD-S9 | 当选中非请求事件，或所在泳道没有其他请求时，该标签页用一行文字说明情况 | `context-compare.test.ts` |

ATIF 导出（见[导出格式](../reference/export-formats.zh-CN.md)）：

| ID | 行为 | 证据 |
|---|---|---|
| A1 | `fixtures/demo.trace.json` 导出的 ATIF 通过 Harbor 校验器；上下文压缩成为带有 `extra.context_management` 的 system 步骤，被它隐藏的事件不生成步骤，从它之前保留的步骤带有 `is_copied_context: true` | `packages/kernel/src/export-atif.test.ts`、`apps/cli/src/export/write-export.test.ts`、`node scripts/validate-exports.mjs` |
| A2 | 每个已注册代理的一致性测试夹具导出的 ATIF 均通过 Harbor 校验器 | `write-export.test.ts`（CI 中的结构化检查）、`node scripts/validate-exports.mjs`（Harbor，手动运行） |

dsh 插件（`@rivus/dsh-estela`）：

| ID | 行为 | 证据 |
|---|---|---|
| DSH-1 | 将 `@rivus/dsh-estela` 安装到 dsh 的 `web` profile 后，已开始的会话在 `Chat` 和 `Trajectory` 旁显示 `Estela` 视图标签页 | `apps/dsh-plugin/test/dsh.smoke.ts` |
| DSH-2 | 切换到 `Estela` 标签页显示会话头部、时间线、虚拟化账本和检查器（`Input`、`Output`、`Model saw`、`Compare`、`Raw`），高度止于输入框上方，且不含「导出报告」按钮 | `dsh.smoke.ts`、`apps/e2e/src/e2e/embed.e2e.ts` |
| DSH-3 | 空白会话不显示视图标签页，也没有 `/estela` 斜杠命令 | `dsh.smoke.ts` |
| DSH-4 | 已开始但磁盘尚无日志的会话显示「This session has no log on disk yet.」且无错误详情 | `apps/dsh-plugin/src/host/channel.test.ts`、`apps/web/src/embed/estela-workspace.test.ts` |
| DSH-5 | 不可读或未知格式代次的日志显示「Could not open this session」且不含会话浏览器链接；当原因为未知格式代次时，还会显示未知格式提示与 GitHub 反馈链接 | `apps/dsh-plugin/src/host/channel.test.ts`、`apps/web/src/embed/estela-workspace.test.ts` |
| DSH-6 | 传输或渲染失败被限制在视图内部并显示「Try again」，不影响其他 dsh 视图，且重试时不重挂元素 | `dsh.smoke.ts`、`apps/e2e/src/e2e/embed.e2e.ts`、`apps/web/src/embed/estela-workspace.test.ts` |
| DSH-7 | 大型会话账本保持虚拟化，同时 dsh 自身的 `POST /api/session/list` 延迟增幅不超过 `DSH_LOAD_STALL_MS` | `dsh.smoke.ts`、`apps/e2e/src/e2e/embed.e2e.ts`、`apps/web/src/embed/estela-workspace.test.ts` |
| DSH-8 | 超过 12 MB 预算的视图会缩短长字符串，并在选中事件时加载完整文本 | `packages/kernel/src/view.test.ts`、`apps/e2e/src/e2e/scale.e2e.ts`（共享工作区选中事件读回全文），以及 [#109](https://github.com/PerfectPan/estela/issues/109#issuecomment-7127872610) 中约 12 MB（`11,931,777` 字节）通过 dsh 通道的实测（`dsh.smoke.ts` 尚未在 dsh 内用 12 MB 视图做端到端验证） |
| DSH-9 | 向运行中的会话追加新帧时，已打开的视图保持原快照且无报错；刷新页面后展示新内容，过期快照会自动重开且不混用状态 | `dsh.smoke.ts`、`apps/dsh-plugin/src/host/sessions.test.ts`、`channel.test.ts`、`stale.test.ts`、`stale-races.test.ts`、`apps/dsh-plugin/src/client/source.test.ts`、`apps/web/src/embed/estela-workspace.test.ts` |
| DSH-10 | 默认脱敏替换主目录路径与敏感凭据；`ESTELA_REDACT=0` 关闭脱敏 | `dsh.smoke.ts`、`apps/dsh-plugin/src/host/lifecycle.test.ts` |
| DSH-11 | 主题与语言跟随 dsh（`ctx.theme` / `ctx.locale`），不写 `document.documentElement` | `dsh.smoke.ts`、`apps/dsh-plugin/src/client/appearance.test.ts`、`apps/e2e/src/e2e/embed.e2e.ts`、`apps/web/src/embed/estela-workspace.test.ts` |
| DSH-12 | 在 `dsh web` 运行期间移除 `@rivus/dsh-estela` 后，标签页消失、`/estela` 返回 405、监听端口不变，且 profile 的 `package.json` 和 `node_modules` 清理干净 | `dsh.smoke.ts` |
| DSH-13 | `engines.dsh` 不兼容的 tarball 安装以退出码 1 拒绝；已装不兼容副本在启动时被禁用且不显示标签页 | `dsh.smoke.ts`、`apps/dsh-plugin/src/package.test.ts` |
| DSH-14 | `/estela` 受 dsh 准入保护（无 cookie 返回 401，跨源返回 403）并拒绝非 owner 对端 | `dsh.smoke.ts`、`apps/dsh-plugin/src/host/channel.test.ts` |

## 已安装 tarball 上的 CLI 冒烟测试

`apps/e2e`（`@rivus/estela-e2e`，私有包）在 `apps/cli` 中运行 `pnpm pack`，将 tarball 安装到空临时目录中，用 `fixtures/sessions/<agent>/conformance` 构建合成 `HOME`（同时设为 Windows 读取的 `USERPROFILE`），并在 `PATH` 最前面放置一个假 `open` / `xdg-open` 脚本来记录 URL 而不真正启动浏览器。Windows 上没有此类替代脚本，因为 DevFrame 在 Windows 通过 `cmd /c start` 打开浏览器；检查打开 URL 的测试在 Windows 上传入 `--no-open` 并仅检查打印的 URL。该套件覆盖 `--help`（通过 `npx`）、S2、S10、S17 与 S18（`mcp.smoke.ts`）、S13（通过 `npx -y node@22` 在 Node.js 22 上运行）、S15 以及 S16（通过 `node-pty` 在伪终端中运行，因 1.1.0 未附带 Linux 预编译包而固定在 `1.2.0-beta.18`）。它不包含在 `pnpm test` 中，因为它需要打包并安装。测试准备阶段会先运行 `pnpm --filter '@rivus/estela...' run build`，因此 tarball 绝不会包含陈旧的打包产物。

```bash
cd apps/e2e
pnpm run test:smoke
```

`TMPDIR` 决定临时目录的位置。`ESTELA_SMOKE_KEEP=1` 在运行结束后保留该目录。`ESTELA_SMOKE_NODE=<path to a node binary>` 使测试在工作区的 Node.js 上运行的同时，使用指定的 Node.js 运行已安装的 CLI。安装步骤需要访问 npm 仓库。CLI 运行时关闭 npm 的更新通知、资助提示和审计消息，因此输出仅包含其自身内容。CI 会在 `test` 作业中使用 Node.js `^26.13.1` 在 Linux 上运行它，并在 `platforms` 作业中使用 Node.js 24 和 26 在 Linux、macOS 和 Windows 上运行它。

## 已安装 tarball 上的浏览器端到端测试

`apps/e2e` 中的 `test:e2e` 是针对浏览器场景的 Playwright 测试套件，仅使用 Chromium，同样针对已安装的 tarball 运行。其全局初始化（`src/e2e/global-setup.ts`）构建 `@rivus/estela`、打包并安装它、利用各代理夹具构建合成主目录（一个包含全部三个代理及一个不可读的 Claude Code 文件，另一个不含 `~/.codex`），并添加假打开器。每个测试都使用 `--port 0`、全新缓存和独立工作目录启动自己的服务器，并在结束后停止。任何控制台错误或页面错误都会导致测试失败。

测试标题注明其验证的[场景](#验收场景)，每个测试文件负责一个区域：会话浏览器、工作区、外观、报告与规模。

```bash
cd apps/e2e
npx playwright install chromium                                   # once; CI adds --with-deps
pnpm run test:e2e
ESTELA_E2E_CHANNEL=chrome pnpm run test:e2e   # use the installed Google Chrome instead
```

S8 运行 `scripts/generate-trace.mjs`，S12 按路径运行 `packages/server/src/testsupport/large-session.ts`，两者均写入本次运行的临时目录并在之后删除输出；不会向仓库提交任何生成文件。`ESTELA_E2E_S12_BYTES` 可在本地快速试用时修改 S12 的大小；默认值（也是 CI 使用的值）为 350 MiB（367,001,600 字节）。`ESTELA_E2E_KEEP=1` 保留临时目录。设置了 `CI` 时，测试套件还会向 `apps/e2e/playwright-report/` 写出 HTML 报告，测试失败时由 CI 作业上传。CI 仅在 `test` 作业中使用 Node.js `^26.13.1` 运行该套件。

## dsh 插件冒烟测试

`apps/dsh-plugin/test/dsh.smoke.ts` 会打包 `@rivus/dsh-estela`，在临时 npm 前缀下安装固定版本的 `@deepseek-ai/dsh`（`apps/dsh-plugin/src/contract/channel.ts` 中的 `DSH_VERSION`），在仅监听 loopback、隔离 `DSH_HOME` 与伪造 `HOME`（不设模型 key、不碰 `~/.dsh`）的环境下启动 `dsh web`，使用 `apps/dsh-plugin/test/seed-session.mjs` 基于 `fixtures/sessions/dsh/conformance/plain` 生成种子会话，并通过 Playwright 覆盖 DSH-1、DSH-2、DSH-3、DSH-6、DSH-7、DSH-9、DSH-10、DSH-11、DSH-12、DSH-13 和 DSH-14。它不包含在 `pnpm test` 中。

```bash
cd apps/dsh-plugin
pnpm run test:smoke
```

`ESTELA_DSH_VERSION` 可覆盖安装的 dsh 版本（例如 `ESTELA_DSH_VERSION=latest`）。`ESTELA_E2E_CHANNEL=chrome` 可在本地改用已安装的 Google Chrome，而不必下载 Playwright Chromium。`ESTELA_SMOKE_KEEP=1` 会在运行结束后保留临时目录。CI 中的 `dsh-plugin` 作业运行在 `ubuntu-latest` 与 Node.js `^26.13.1` 上：PR 触发时针对固定版本运行，每周 `schedule` 和手动 `workflow_dispatch` 时针对 dsh 的 `latest` 标签运行。每周 `latest` 运行标红时，先看是哪一步失败；确认是新版 dsh 破坏了兼容性（而非依赖安装、Chromium 或 runner 故障）后，再更新 `apps/dsh-plugin`、保持 `DSH_VERSION` 与 `engines.dsh` 对齐（`apps/dsh-plugin/src/package.test.ts` 锁定了下界）并发布新版本插件（0.x 期间收窄 `engines.dsh` 属于 minor 发布）。

## 在真实浏览器中检查

完成界面改动前，请在合成 `HOME` 上通过开发服务器在真实浏览器中检查效果。网页应用从 `apps/web/dist` 提供服务，因此修改界面后请重新构建它：

```bash
pnpm --filter @rivus/estela-web run build
```

### 合成主目录与生成的 trace

根据代理夹具构建主目录（不含真实会话内容）：

```bash
H="$TMPDIR/estela-home"; rm -rf "$H"
mkdir -p "$H/.claude/projects" "$H/.codex/sessions/2026/09/25" "$H/.grok/sessions"
for f in plain compaction subagent; do
  mkdir -p "$H/.claude/projects/app-$f"
  cp -R fixtures/sessions/claude-code/conformance/$f/* "$H/.claude/projects/app-$f/"
done
mkdir -p "$H/.claude/projects/app-bad"
cp fixtures/sessions/claude-code/unknown-generation/session.jsonl "$H/.claude/projects/app-bad/"
for f in plain compaction token-count subagent; do
  cp fixtures/sessions/codex/conformance/rollout-$f.jsonl "$H/.codex/sessions/2026/09/25/"
done
for f in plain compaction subagent; do
  cp -R fixtures/sessions/grok/conformance/$f "$H/.grok/sessions/grok-$f"
done
```

`scripts/generate-trace.mjs` 生成一个形如 Claude Code 会话的合成规范 trace（包含轮次、递增的输入 Token、工具调用、失败、长输出、钩子运行、两条子代理泳道、上下文压缩）。按路径打开它：

```bash
node scripts/generate-trace.mjs --events 640 --name design.trace.json   # about the size of the design mockup
node scripts/generate-trace.mjs --events 10000 --name s8.trace.json      # S8
HOME="$H" XDG_CACHE_HOME="$TMPDIR/estela-cache" \
  node apps/cli/bin.mjs "$TMPDIR/estela-generated/design.trace.json" --no-auth --no-open --port 7461
```

测试 S12 时，将 350 MB 的 Codex 格式文件写入第二个主目录，并从会话列表打开它，以便浏览器显示加载进度：

```bash
mkdir -p "$TMPDIR/estela-big/.codex/sessions/2026/09/25"
node -e "import('./packages/server/src/testsupport/large-session.ts').then(m => m.writeLargeCodexSession(process.argv[1], { targetBytes: 350e6 }))" \
  "$TMPDIR/estela-big/.codex/sessions/2026/09/25"
HOME="$TMPDIR/estela-big" XDG_CACHE_HOME="$TMPDIR/estela-cache-big" node apps/cli/bin.mjs --no-auth --no-open --port 7464
```

完成后删除生成的文件。

### 驱动浏览器

`chrome-devtools-mcp` 会启动自己的无头 Chrome；务必传入以下两个退出遥测的 flag，因为默认情况下它会向 Google 发送使用统计信息，并可能将 trace URL 发送到 CrUX API：

```bash
npx -y chrome-devtools-mcp@1.10.1 --headless --isolated --no-usage-statistics --no-performance-crux
```

通过 stdio 从 MCP 客户端驱动它。常用工具：`new_page`、`emulate`（`viewport: 1440x900x1`、`colorScheme`）、`take_screenshot`、`evaluate_script`、`list_console_messages`、`performance_start_trace`。传入 `--chromeArg=--lang=zh-CN --chromeArg=--accept-lang=zh-CN` 可切换至中文界面。也可以使用 Playwright（在仓库外的临时目录安装 `playwright-core` 并使用 `channel: 'chrome'`）；在 context 上设置 `viewport`、`colorScheme` 和 `locale` 即可。

工作区改动需检查的内容：

- 在 1440 × 900 分辨率下截取深色与浅色、英文与 `zh-CN` 的 `#/s/<traceId>` 页面，并与相同尺寸的 `docs/design/session-workspace-{dark,light}.html` 对比。列出所有可见差异。
- S5：在 Claude Code 上下文压缩夹具上，时间线存在一个 `[data-marker=compaction]`，其 `data-label` 为 `compacted  1k → 100`。
- S6：在 `[data-testid=timeline-plot]` 上拖动；`[data-testid=timeline-range]` 显示所选范围和事件数。聚焦 `[data-testid=brush-from]` 并按方向键（配合 Shift 按 10 % 步长移动）；`aria-valuenow` 随之变化。
- S7：选中上下文压缩后的请求并打开「模型所见」：在没有提示词快照的会话中，`[data-slot=system]` 和 `[data-slot=tools]` 具有 `data-status="unavailable"`；在带有快照的会话（Claude Code，自 2.1.268 起）中，它们具有 `data-status="present"`，且每一行的 `[data-testid=slot-source]` 都会选中对应快照。在快照会话的第 #1 个请求处，工具显示为 `unavailable` 并附带「只在此事件之后」说明。`[data-testid=dropped]` 列出被移除的事件。
- S8：在 10,000 个事件的 trace 上，将 `[data-testid=ledger]` 滚动到底部，同时统计 `[role=option]` 元素数量（少于 100 个）并收集 `PerformanceObserver` 的 `longtask` 记录（没有超过 200 ms 的长任务）。录制本次滚动的性能 trace。
- S12：加载面板显示已读取字节数占文件大小的比例；加载完成后可以看到 `[data-testid=shortened]` 标记，选中该行会加载完整文本。
- 控制台没有任何错误或警告。请将截图和 trace 文件保存在仓库之外。

仅在本地服务器上调试脱敏行为时才设置 `ESTELA_REDACT=0`；`build` 始终执行脱敏。
