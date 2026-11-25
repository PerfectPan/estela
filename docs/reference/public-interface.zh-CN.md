> 中文阅读版。以英文原文 docs/reference/public-interface.md 为准。

<!-- source-blob: 3001889ae3b9663a35c016abf45819c3014ea383 -->

# 公共接口与兼容性

读者对象：通过脚本调用 Estela 或将其接入其他工具的用户，以及决定版本升级幅度的维护者。本文档列出 `@rivus/estela` 和 `@rivus/dsh-estela` 的语义化版本控制（semver）覆盖范围、实验性部分以及不覆盖的部分。对已覆盖接口的改动必须在同一个 pull request 中同步更新本文档与[用户指南](../guide/README.zh-CN.md)。

## 版本策略

`@rivus/estela` 目前处于 0.x 阶段。在 1.0 之前，对已覆盖接口的破坏性变更在 minor 版本中发布，并附带说明变更内容的 changeset；问题修复在 patch 版本中发布。从 1.0 开始，对已覆盖接口的破坏性变更需要 major 版本，新功能需要 minor 版本，修复需要 patch 版本（见[发布意图](../../CONTRIBUTING.md#release-intent)）。

当原本配合上一版本工作的脚本、MCP 客户端或工具停止工作或语义发生改变时，即构成破坏性变更：移除或重命名命令、选项、环境变量或 MCP 工具；新增必填输入；更改默认值；更改退出码；或移除、重命名此处已覆盖输出中的字段。新增可选输入、输出字段、命令或工具不属于破坏性变更。

## 覆盖范围

### 命令行

| 命令 | 参数 | 选项 |
|---|---|---|
| `estela` | `[session]`（默认为 `ESTELA_PATH`） | `--port <n>`（0–65535；默认为 7392 或下一个空闲端口）、`--host <host>`（默认为 `localhost`）、`--open` / `--no-open`（默认开启）、`--auth` / `--no-auth`（默认开启）、`--mcp` / `--no-mcp`（默认关闭）、`--pick` / `--no-pick`、`--index` / `--no-index`（默认开启） |
| `estela build` | `[session]`（默认为 `ESTELA_PATH`，否则为内置示例 trace） | `--out-dir <dir>`（默认为 `dist-static`） |
| `estela mcp` | `[session]`（默认为 `ESTELA_PATH`，否则为发现的所有会话） | 无 |
| `estela export-atif` | `[session]`（默认为 `ESTELA_PATH`，否则为内置示例 trace） | `--out <file>`（默认为 `estela-<session>.atif.json`） |
| `estela export-otlp` | `[session]`（默认为 `ESTELA_PATH`，否则为内置示例 trace） | `--out <file>`（默认为 `estela-<session>.otlp.json`） |

每个命令都接受 `-h` / `--help` 和 `-v` / `--version`。会话参数可以是会话文件、`path#sessionId` 或规范 Estela JSON 文件；`--` 之后的 token 会被视为会话参数，用于以 `-` 开头的路径。属于公共接口的解析规则：

- 未知选项、第二个会话参数、重复传入同一个选项、使用 `=` 书写的开关（`--open=false`），或将 `-` 作为输出路径，均会在读取任何会话前被拒绝。
- 写在命令名之前的会话参数或选项（`estela --port 1 build x`）会被拒绝。
- 在主命令下，与命令同名的裸词会被识别为该命令；使用此类名称的参数值需写作 `--host=build` 或 `./build`。
- `--pick` 需要交互式终端，且不能与会话参数同时使用。
- `--host <host>` 会在打印和打开的 URL 中保留显式的回环地址（`127.0.0.1`、`::1`），并在传入 `0.0.0.0` 时打印和打开 `127.0.0.1`、传入 `::` 时打印和打开 `[::1]`。当 `--host` 不是回环地址（`localhost`、`127.*`、`::1`）时，`--no-auth` 和 `--mcp` 会在服务器启动前被拒绝。
- `build --out-dir` 只接受新目录、空目录，或仅包含先前 Estela 报告 `index.html` 的目录，并拒绝 `/`、工作目录、主目录、符号链接和非目录路径。
- 当默认文件名已存在（包括符号链接）时，`export-atif` 和 `export-otlp` 会追加 `-2`、`-3` 等后缀，并拒绝通过传入 `--out` 的符号链接写入。

用于检测变更的测试：`apps/cli/src/entry/routes.test.ts`（覆盖所有路由、选项、默认值和两套帮助文本）、`apps/cli/src/entry/app.test.ts`（用法错误、`--`、版本输出行）以及 `apps/e2e/src/cli.smoke.ts`（在已安装的 tarball 上测试 `--help`、`--version` 和未知参数）。

`--help`、进度行和错误消息的措辞及排版面向人工阅读，可能在任意版本中调整。

### 退出码

| 退出码 | 触发场景 |
|---|---|
| 0 | 成功；`--help`；`--version` |
| 1 | 所有失败情况：用法错误、会话无法加载、构建或导出失败、端口或主机监听失败、不安全输出路径被拒绝、索引启动失败、没有可供选择的会话、取消选择、Node.js 版本低于 24，以及任何非预期错误 |

失败类型及其退出码统一定义在 `apps/cli/src/entry/failure.ts` 的一张表中；新增失败类型而未登记会导致类型检查失败。`app.test.ts` 和 `cli.smoke.ts` 断言退出码为 1。

### 环境变量

| 变量 | 作用 | 测试 |
|---|---|---|
| `ESTELA_PATH` | 所有命令的默认会话；为空字符串时视为未设置 | `apps/cli/src/entry/app.test.ts`；默认值写明于 `routes.test.ts` 固定的帮助文本中 |
| `ESTELA_MCP_TOKEN` | `--mcp` 路由要求的 bearer 令牌；未设置或为空时，开发服务器每次启动生成一个并打印出来。使用 `--mcp` 时，不是不含空格的可见 ASCII 字符的值属于用法错误 | `apps/cli/src/entry/app.test.ts`、`apps/cli/src/entry/ui/terminal.test.ts`、`apps/e2e/src/mcp.smoke.ts` |
| `ESTELA_REDACT` | 设为 `0` 时关闭本地服务器及 ATIF 和 OTLP 导出的脱敏；报告和 MCP 结果始终脱敏 | `write-export.test.ts`、`packages/server/test/agent-tools.test.ts`（S18） |
| `NO_COLOR` | 输出不含转义序列的纯文本行（stdout 不是终端时也输出纯文本行） | `apps/cli/src/entry/ui/terminal.test.ts`、`cli-smoke.test.ts` |
| `XDG_CACHE_HOME` | 会话索引的存放位置（`$XDG_CACHE_HOME/rivus-estela/`） | `packages/runtime-node` 索引测试 |
| `ANTIGRAVITY_GEMINI_DIR`、`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`DSH_HOME`、`DIMCODE_HOME`、`GEMINI_CLI_HOME`、`GROK_HOME`、`KIMI_CODE_HOME`、`XDG_DATA_HOME`、`PI_CODING_AGENT_DIR`、`QODER_CONFIG_DIR`、`ZCODE_STORAGE_DIR` | 各代理自身的主目录覆盖变量，按各代理的方式读取 | `@rivus/agent-kit` 中的会话读取器测试 |

### 会话位置

[支持的代理](../guide/supported-agents.zh-CN.md#会话位置)中列出的默认位置和主目录覆盖变量。移除某个代理，或不再从已记录的位置发现会话，均属于破坏性变更。若代理新版本的日志格式被读取器拒绝，则在 patch 版本中修复。

### MCP 工具

覆盖范围：七个工具名称及其输入 schema（属性名、类型、范围、默认值以及拒绝未知属性），详见 [MCP 工具参考](mcp-tools.zh-CN.md#输入)；40,000 字符的上限；`@e<n>` / `@l<n>` 形式的 id；以及结果和错误始终脱敏。测试：`packages/server/src/agent-tools/inputs.test.ts`（schema 与错误文本）、`packages/server/test/agent-tools.test.ts`（工具列表、schema、遍历流程、恶意会话）、`apps/e2e/src/mcp.smoke.ts`（S17、S18，以及在已安装 tarball 上测试 `--mcp` HTTP 路由）、`apps/cli/test/cli-smoke.test.ts`（S10）。

结果字段已记录在[参考文档](mcp-tools.zh-CN.md#结果)中，并将在与代理用户评审字段结构后，从 1.0 起纳入覆盖范围；在此之前它们可能在 minor 版本中变更。错误文本面向人工阅读：输入无效时 Estela 部分以 `estela_<tool>: <field>:` 开头，DevFrame 会添加其自身前缀。

HTTP 路由 `/__estela/__mcp` 仅在使用 `--mcp` 时存在（`--mcp` 要求回环地址的 `--host`），并作为提供相同七个工具的路由纳入覆盖范围。请求需要 `Authorization: Bearer <token>`，令牌来自 `ESTELA_MCP_TOKEN` 或启动时打印的那个，`Host` 为回环地址，并且不带 `Origin` 请求头或带回环地址的 `Origin`（否则 HTTP 401）；该路由不响应 CORS 预检，一次性验证码也不保护该路由。启动时打印的 `MCP: <url>` 和 `MCP header: Authorization: Bearer <token>` 两行（用户自己设置的令牌显示为 `$ESTELA_MCP_TOKEN`）纳入覆盖范围。测试：`apps/e2e/src/mcp.smoke.ts`。

### 报告文件

`build` 和「导出报告」写出单个无需服务器即可从 `file://` 打开的 `index.html`，始终经过脱敏，包含全部事件的视图以及前 2,000 个事件或 20 MB 的原始记录。覆盖范围：它是一个自包含的单文件且经过脱敏。其内部结构（内嵌的 `report-trace` JSON）不在覆盖范围内。测试：`apps/e2e/src/e2e/report.e2e.ts`（S9）、`apps/cli/test/report-build.test.ts`。

### ATIF 导出

[导出格式](export-formats.zh-CN.md#atif)中固定为 ATIF v1.8 的映射，包括其列出的 `extra.estela` 字段。切换到其他 ATIF 版本属于破坏性变更。测试：`packages/kernel/src/export-atif.test.ts`、`export-atif-cost.test.ts`、`apps/cli/src/export/write-export.test.ts`（A1、A2）；`node scripts/validate-exports.mjs` 可手动运行 Harbor 的校验器。

### 目录价

费用数字取决于每个版本随附的价格快照；每处费用都会标明所用的快照。更新快照导致金额变化不属于破坏性变更。

### dsh 插件（`@rivus/dsh-estela`）

DeepSeek Harness 插件以 `@rivus/dsh-estela` 发布，支持 `web` profile（见[DeepSeek Harness 插件](../guide/dsh-plugin.zh-CN.md)）。覆盖范围：

- 包名（`@rivus/dsh-estela`）、安装命令 `dsh plugin --profile web add @rivus/dsh-estela` 以及卸载命令 `dsh plugin --profile web remove @rivus/dsh-estela`。
- 在已开始会话的 Chat 和 Trajectory 旁名为「Estela」的对话视图标签页。
- `engines.dsh` 中声明的受支持 DeepSeek Harness 版本范围（`>=0.2.2-rc.5 <0.3.0-0`）。
- 默认开启脱敏，在 `dsh` 进程环境中设置 `ESTELA_REDACT=0` 可关闭脱敏。
- 插件没有任何配置项。

其版本策略与 `@rivus/estela` 的 0.x 策略相同：在 1.0 之前，对已覆盖接口的破坏性变更随 minor 版本发布（从 1.0 起随 major 版本发布），问题修复随 patch 版本发布。收窄 `engines.dsh` 范围属于破坏性变更，在 0.x 期间随 minor 版本发布。

测试：`apps/dsh-plugin/src/package.test.ts`（清单字段与 `engines.dsh`）、`apps/dsh-plugin/src/host/channel.test.ts`（脱敏、仅限 owner 访问、失败模式）、`apps/dsh-plugin/src/host/sessions.test.ts` 与 `stale.test.ts`（快照保障）以及 `apps/dsh-plugin/test/package-artifacts.test.ts`（打包后的 tarball 与产物边界）。

## 实验性内容

- **OTLP 导出。**`export-otlp` 固定使用 OpenTelemetry GenAI 语义约定 `gen-ai-dev/1.42.0-dev`，这是一个尚未发布的开发版本。属性名称遵循该版本，当未来固定到正式发布版本时将会变化，即使在 1.0 之后也可能在 minor 版本中调整。命令及其选项在覆盖范围内；span 与属性映射不在覆盖范围内。测试：`packages/kernel/src/export-otlp.test.ts`。

## 不在覆盖范围内

- **Workspace 包。**`@rivus/estela-server`、`-rpc`、`-kernel`、`-schema`、`-runtime-node` 和 `-web` 均为私有包并打包进 CLI 与 dsh 插件；`@rivus/estela` 不导出编程 API。
- **dsh 插件内部实现。**插件的 RPC 通道和端点名称、`<estela-workspace>` 自定义元素及其 `source` 属性、`@rivus/dsh-estela` 包内的文件，以及视图内提示信息的措辞。
- **规范 trace JSON 格式**（`schema: "estela"`）。它没有版本字段且会就地修改；没有任何命令写出该格式，来自其他版本的文件可能无法加载。
- **会话索引**（`index.sqlite`）：缓存文件，在数据结构或版本变化时会重建。
- 打包后的服务器与网页应用之间的 **DevFrame RPC**、其共享状态及其文件（`~/.devframe/instances/`、`~/.estela/devframe/`）。
- 网页应用中除服务器路径 `/__estela/` 之外的 **URL**、trace id，以及网页界面的布局与文案。
- **更名为 Estela 之前的旧名称**（`@rivus/agent-trace`、`AGENT_TRACE_*`）：不再读取。
