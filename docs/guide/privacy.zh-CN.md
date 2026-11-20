> 中文阅读版。以英文原文 docs/guide/privacy.md 为准。

<!-- source-blob: 63c9d0745337079acf8994eec149c060cc0be435 -->

# 隐私与脱敏

Estela 在你的本机运行，不向任何地方发送数据。它读取会话日志，从不写入这些日志。本页列出它保存的内容、脱敏移除的内容，以及不会移除的内容。

## 留在本地的内容

- 服务器默认绑定 `localhost`。浏览器页面需要来自打开 URL 的一次性验证码（或终端打印的验证码）；`--no-auth` 会关闭该检查。
- `--no-auth` 会打印启动警告，且当 `--host` 不是回环地址（`localhost`、`127.*`、`::1`）时会被拒绝。即使绑定在回环地址上，服务器仍接受不带 `Origin` 请求头的非浏览器请求，本机任意进程都可发送此类请求，因此仅在对合成会话进行本地开发时使用 `--no-auth`。浏览器的 WebSocket 和 SSE `Origin` 检查会匹配绑定的端口和主机：默认 `localhost` 接受任意回环来源（`localhost`、`127.*`、`[::1]`）；显式指定回环 `--host`（`127.0.0.1`、`[::1]`）只接受该精确主机；通配地址 `0.0.0.0` 或 `::` 只接受回环来源以及本机网络接口的 IP 字面量（DNS 名称会被拒绝）。
- `--host <address>` 绑定其他地址。使用 `--host 0.0.0.0` 时，同一网络中的其他机器可以访问该服务器，并受一次性验证码门禁保护。
- URL 只携带不透明的 trace id，从不携带文件路径。
- 通过 HTTP 提供的 MCP 路由仅在使用 `--mcp` 时存在，且 `--host` 不是回环地址时会拒绝 `--mcp`。它不受一次性验证码保护，而是由 bearer 令牌保护：Estela 启动时打印的令牌，或 `ESTELA_MCP_TOKEN`。本机上持有令牌的任何进程都能通过该路由读取所有会话，请妥善保管令牌。在共享机器上，请使用每次启动生成的令牌，不要把固定令牌写进客户端配置：Estela 停止运行时监听该端口的其他用户会收到客户端发送的请求头（见 [MCP 工具](mcp.zh-CN.md#通过本地服务器的-http-路由)）。

Estela 写入的文件：

| 文件 | 内容 |
|---|---|
| `$XDG_CACHE_HOME/rivus-estela/index.sqlite`（默认为 `~/.cache/rivus-estela/`） | 会话索引，见下文 |
| `~/.devframe/instances/<pid>-<port>.json` | 每个运行中服务器对应一条记录（端口、路径、启动时间），由服务器框架 DevFrame 写入 |
| `~/.estela/devframe/auth.json` | 通过一次性验证码授权的浏览器令牌，由 DevFrame 写入（POSIX 上 `~/.estela/devframe/` 权限模式为 `0700`） |
| 报告或导出文件 | 仅在你运行 `build`、「导出报告」、`export-atif` 或 `export-otlp` 时写入 |

## 会话索引

索引是一个缓存，用于让会话浏览器在下次启动时快速显示。它为每个会话保存：标题、工作目录和会话文件路径、统计数字（轮次、请求、Token、时长、标记），以及最多 200 条你亲自输入的提示词（每条最多 500 个字符），用于搜索。它不保存代理的回复、工具输出、文件内容或代理注入的文本。**索引未脱敏**：标题、路径和提示词按原样保存，包括你在提示词中输入的任何机密信息。该文件权限模式为 0600（仅你可读）。

删除它是安全的；下次启动时会从日志重建：

```sh
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/rivus-estela"
```

`--no-index` 启动时不读写索引；此时每次启动都会重新计算摘要，且搜索仅覆盖标题和首条提示词。

## 脱敏覆盖的范围

脱敏替换三类文本：

- **你的主目录**在 Estela 识别的所有拼写形式下都会变为 `~`：普通路径、去掉前导 `/` 的形式、JSON 转义形式（`\/Users\/<name>`）、URL 编码形式、Claude Code 的短横线拼接目录名和 Grok 的 `%2F` 形式，以及 `~<name>`，不区分大小写，同时覆盖值和键。更长的名称（如 `/Users/<name>x` 或 `/Users/<name>.bak`）保留原样。截断到 80 个字符的标题或截断到 500 个字符的首条提示词如果停在主目录路径中间，这段残缺路径也会被替换。
- **已知形式的令牌**会变为 `[redacted]`：以 `sk-` 开头的密钥（OpenAI、Anthropic）、AWS 密钥 id（`AKIA`、`ASIA`）、GitHub 令牌（`ghp_`、`gho_`、`ghu_`、`ghs_`、`ghr_`、`github_pat_`）、Slack 令牌（`xoxa-`、`xoxb-`、`xoxp-`、`xoxr-`、`xoxs-`）、npm 令牌（`npm_`）、Stripe 密钥（`sk_live_`、`sk_test_`、`rk_live_`、`rk_test_`）、GitLab 令牌（`glpat-`）、Hugging Face 令牌（`hf_`）、Google API 密钥（`AIza…`）、JWT、Slack webhook URL 以及 PEM 私钥块。
- **带名称的凭据**的值会变为 `[redacted]`：凭据名称后面的值，如 `PASSWORD=`、`DB_PASSWORD:`、`client_secret:`、`GITHUB_TOKEN=`、`SECRET_KEY=`、`X-Api-Key:` 或 `aws_secret_access_key =`，无论是原样、带引号还是 JSON 转义；`Authorization: Bearer`、`Basic` 或 `Token` 后面的值；单独出现、长度至少 16 个字符且含数字的 `Bearer` 值；以及 URL 中的密码（`postgres://user:password@host`）。看起来像代码、标签或数字的值会保留：不带引号且不含数字的值（`token = getToken()`），带引号、不含数字且短于 20 个字符或含空格或点号的值（`"password": "Password"`），占位符（`${TOKEN}`、`<token>`、`***`），以及数字。

其余所有内容均原样保留：**脱敏只替换你的主目录、上面列出的令牌形式和带名称凭据的值**，会话正文和文件内容都会保留。**脱敏不会移除**的内容包括但不限于：既没有已知形式、前面也没有凭据名称的机密（单独一行的 AWS secret access key、正文里的密码），按上面的规则看起来像代码的凭据值（`PASSWORD=hunter`），名称不是凭据名称的 `KEY=value` 赋值，以及出现在主目录路径之外的你的用户名。如果代理在会话中运行了 `cat .env` 或 `env`，脱敏识别不出的值就在其日志以及由日志生成的所有产物中。

## 脱敏生效的位置

| 输出 | 脱敏 |
|---|---|
| 本地服务器：工作区、会话列表、`--pick` 标签、错误消息 | 开启，除非设置 `ESTELA_REDACT=0` |
| `export-atif`、`export-otlp` | 开启，除非设置 `ESTELA_REDACT=0` |
| 报告（`build`、「导出报告」） | 始终开启，无论 `ESTELA_REDACT` 如何设置 |
| MCP 工具结果与错误 | 始终开启，无论 `ESTELA_REDACT` 如何设置 |

`ESTELA_REDACT=0` 仅用于在本机调试，或用于需要未脱敏数据的导出数据集。

## 报告中仍保留的内容

报告是一个包含会话文本的 `index.html`：你的提示词、模型的回复、工具调用及其输出，以及代理读取或写入的文件内容，仅扣除上述脱敏内容。它包含每个事件的已截短视图，以及前 2,000 个事件或 20 MB 的完整文本和原始日志记录。**分享报告前请先阅读内容。**报告的横幅中也写明了相同提示。

MCP 工具结果同样包含会话文本。调用这些工具的代理必须将该文本视为数据，而不是指令（见 [MCP 工具](mcp.zh-CN.md#结果是数据而非指令)）。
