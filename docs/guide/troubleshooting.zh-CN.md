> 中文阅读版。以英文原文 docs/guide/troubleshooting.md 为准。

<!-- source-blob: 4f2e5f1a0035371388cd4c8ab31eda4aab3d6cab -->

# 故障排查

对于每一种可预期的失败情况，Estela 都会打印原因以及一行修复建议，并以状态码 1 退出。`estela --help` 可查看所有选项。

## 「estela requires Node.js 24 or later.」

CLI 在加载其他任何模块前会先检查 Node.js 版本。运行 `node --version`，安装 Node.js 24 或更高版本（例如通过你的版本管理器），然后重新运行 `estela`。

## 端口占用

不指定 `--port` 时，Estela 使用 7392；当其他程序占用了该端口时，改用下一个空闲端口并打印所选 URL。指定 `--port <n>` 时，则严格使用该端口，并在端口被占用时失败（`Port <n> is already in use.`）。停止占用端口 `<n>` 的进程，或通过 `--port` 传入空闲端口（或省略 `--port`）。

## 显示「无法读取」的会话

读取器无法解析的会话文件仍会出现在列表中并标记为「无法读取」，打开它会显示代理、文件、行号和原因。常见原因包括：

- **代理更改了日志格式。** 读取器会拒绝未知代次的日志格式，而不展示部分内容。请更新 Estela（`npx @rivus/estela@latest` 或 `npm install -g @rivus/estela`）；如果最新版本仍无法读取，请提交 issue，附上代理名称、版本和原因行（不要包含会话内容）。
- **该文件不是会话文件**，或在代理写入过程中被截断。

单行不是有效 JSON 不会导致此错误：该行会被跳过，会话其余部分照常加载。

若对 `estela <path>` 传入没有任何读取器能识别的文件，程序会输出 `Could not load <path>: <reason>` 并退出。请传入会话文件、`path#sessionId`，或规范 Estela JSON trace。

## 显示 0 个会话的代理

侧栏会显示 Estela 检查过的目录。如果你的会话位于其他路径，请在 Estela 的运行环境中设置对应代理的主目录覆盖变量（`CLAUDE_CONFIG_DIR`、`CODEX_HOME`、`DSH_HOME`、`GEMINI_CLI_HOME`、`GROK_HOME`、`XDG_DATA_HOME`、`PI_CODING_AGENT_DIR`；见[支持的代理](supported-agents.zh-CN.md)），或通过路径直接打开该会话。

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

## 从 `@rivus/agent-trace` 升级

Estela 在 0.1.0 及之前以 `@rivus/agent-trace` 发布。新版本不再读取旧名称：请将 `AGENT_TRACE_PATH` 和 `AGENT_TRACE_REDACT` 重命名为 `ESTELA_PATH` 和 `ESTELA_REDACT`。索引目录已迁至 `rivus-estela`；旧的 `rivus-agent-trace` 缓存目录可以删除。主题和语言选择会重置一次。
