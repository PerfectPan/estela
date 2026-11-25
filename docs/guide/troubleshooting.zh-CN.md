> 中文阅读版。以英文原文 docs/guide/troubleshooting.md 为准。

<!-- source-blob: 6ca9f2c494f16da8fe3f163ba30d667304f1dcf4 -->

# 故障排查

对于每一种可预期的失败情况，Estela 都会打印原因以及一行修复建议，并以状态码 1 退出。`estela --help` 可查看所有选项。

## 「estela requires Node.js 24 or later.」

CLI 在加载其他任何模块前会先检查 Node.js 版本。运行 `node --version`，安装 Node.js 24 或更高版本（例如通过你的版本管理器），然后重新运行 `estela`。

## 端口占用

不指定 `--port` 时，Estela 使用 7392；当其他程序占用了该端口时，改用下一个空闲端口并打印所选 URL。指定 `--port <n>` 时，则严格使用该端口，并在端口被占用时失败（`Port <n> is already in use.`）。停止占用端口 `<n>` 的进程，或通过 `--port` 传入空闲端口（或省略 `--port`）。

## 显示「无法读取」的会话

读取器无法解析的会话文件仍会出现在列表中并标记为「无法读取」，打开它会显示代理、文件、行号和原因。常见原因包括：

- **代理更改了日志格式。** 读取器会拒绝未知代次的日志格式，而不展示部分内容。`@rivus/agent-kit` 发布更新后的读取器后，Estela 会发布补丁版本。请更新 Estela（`npx @rivus/estela@latest` 或 `npm install -g @rivus/estela`）；如果最新版本仍无法读取，请[提交 issue](https://github.com/PerfectPan/estela/issues/new/choose)，附上代理名称、版本和原因行（不要包含会话内容）。
- **该文件不是会话文件**，或在代理写入过程中被截断。

单行不是有效 JSON 不会导致此错误：该行会被跳过，会话其余部分照常加载。

若对 `estela <path>` 传入没有任何读取器能识别的文件，程序会输出 `Could not load <path>: <reason>` 并退出。请传入会话文件、`path#sessionId`，或规范 Estela JSON trace。

## 显示 0 个会话的代理

侧栏会显示 Estela 检查过的目录。如果你的会话位于其他路径，请在 Estela 的运行环境中设置对应代理的主目录覆盖变量（`ANTIGRAVITY_GEMINI_DIR`、`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`DSH_HOME`、`DIMCODE_HOME`、`GEMINI_CLI_HOME`、`GROK_HOME`、`KIMI_CODE_HOME`、`XDG_DATA_HOME`、`PI_CODING_AGENT_DIR`、`QODER_CONFIG_DIR`、`ZCODE_STORAGE_DIR`；见[支持的代理](supported-agents.zh-CN.md)），或通过路径直接打开该会话。

## “会话目录不可读”

Estela 无法读取某个代理的会话目录，例如当前用户进不去的 `~/.claude`。Estela 会启动并列出其他代理的会话。该代理的列表中会显示一条「无法读取」的记录及其原因，终端会说明是哪个目录、原因是什么（目录显示为 `~`）。上级目录进不去时，每个代理都会报告。出问题的是会话目录本身时，你会看到什么取决于该代理的读取器。Claude Code、Codex、DSH、Gemini CLI、Grok、Pi 和 Qoder CLI 每个会话一个文件，目录进不去或列不了时都会报告，有记录也有终端提示。OpenCode、ZCode 和 DimCode 读取的是目录里的一个数据库文件：目录进不去时，它们显示「无法读取」的记录，但不出终端提示；目录进得去、只是不能列出内容时，它们的会话照常列出，因为那个文件仍然读得到。Kimi Code 和 Antigravity CLI 在这两种情况下都不报告，因此显示 0 个会话和 Estela 检查过的目录，不出提示。这五个代理显示 0 个会话时，请自行检查目录权限。请确认当前用户对这个目录有读权限（r），对它和上级目录有进入权限（x），或将该代理的主目录覆盖变量（见上文）指向你能读取的目录，然后重新启动。`--no-index` 对此没有帮助：无论是否使用索引，Estela 都要读取这些目录来列出会话。

## 索引问题

[会话索引](privacy.zh-CN.md#会话索引)只是缓存。如果无法打开它（例如缓存目录只读），Estela 会打印一条警告并在不使用索引的情况下继续运行。如果在启动期间建索引失败，它会以 `Could not index sessions: <reason>` 退出并建议使用 `--no-index`。

当列表看起来有误或过时，可以删除缓存后重新启动：

```sh
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/rivus-estela"
```

使用 `--no-index` 可以在该次启动中不读写索引。

## 「与 Estela 服务的连接已断开。」

页面失去了与本地服务器的连接：可能是 `estela` 进程已停止，或计算机进入睡眠。已经加载的工作区仍可继续阅读。重新启动 `estela` 并点击「重新加载」。

如果你启动 Estela 时显式指定了 `--host`（如 `127.0.0.1` 或 `[::1]`），请打开终端中打印的准确 URL，而不是 `http://localhost:<port>/`——来自不匹配来源主机的浏览器 WebSocket 和 SSE 连接会被 HTTP 403 拒绝。使用 `--host 0.0.0.0` 时终端打印 `http://127.0.0.1:<port>/`，使用 `--host ::` 时打印 `http://[::1]:<port>/`：`localhost` 可能先解析到另一地址族并连接到该端口上的其他程序。

## `--pick` 失败

`--pick` 需要交互式终端，且不能与会话路径同时使用。「No sessions to pick.」表示所检查的目录下没有任何受支持代理的会话。

## 用作参数值的命令名

在主命令下，与命令同名的裸词（`build`、`mcp`、`export-atif`、`export-otlp`）会被识别为该命令。与命令同名的主机名需写作 `--host=build`，同名的会话文件需写作 `./build`。

## dsh 提示插件不兼容

`@rivus/dsh-estela` 在 `engines.dsh` 中声明其支持的 DeepSeek Harness 版本范围（`>=0.2.2-rc.5 <0.3.0-0`；见[DeepSeek Harness 插件](dsh-plugin.zh-CN.md#版本范围)）。

- **安装时：**如果当前 `dsh` 版本不在 `engines.dsh` 范围内，`dsh` 会在安装任何文件前拒绝操作、以状态码 1 退出，并打印未满足的版本要求。
- **升级或降级 `dsh` 后：**如果插件已安装在 `web` profile 中，而 `dsh` 版本落到了 `engines.dsh` 范围之外，`dsh` 会跳过该插件启动、在 stderr 打印一行说明禁用原因，且 `dsh web` 不再显示 Estela 标签页。

请使用在 `engines.dsh` 范围内的 `dsh` 版本，或在支持该 `dsh` 版本的 `@rivus/dsh-estela` 发布后更新插件。如果你希望明确接受风险、仅在某一个确切的 `dsh` 版本上允许某一个确切的插件版本运行，请运行：

```sh
dsh plugin --profile web allow-version @rivus/dsh-estela@<plugin-version> --dsh-version <current-dsh-version> --accept-risk
```

## 从 `@rivus/agent-trace` 升级

Estela 在 0.1.0 及之前以 `@rivus/agent-trace` 发布。新版本不再读取旧名称：请将 `AGENT_TRACE_PATH` 和 `AGENT_TRACE_REDACT` 重命名为 `ESTELA_PATH` 和 `ESTELA_REDACT`。索引目录已迁至 `rivus-estela`；旧的 `rivus-agent-trace` 缓存目录可以删除。主题和语言选择会重置一次。
