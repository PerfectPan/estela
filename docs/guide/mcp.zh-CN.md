> 中文阅读版。以英文原文 docs/guide/mcp.md 为准。

# MCP 工具

`estela mcp` 是基于 stdio 的 MCP 服务器。它为代理提供只读工具，用于查找先前的会话、读取其轮次、请求和事件，以及重建模型在某个请求时看到的内容：例如用于回答「为什么在这个项目的上一次会话里测试失败了」。

## 启动方式

```sh
estela mcp            # every session on this machine
estela mcp <session>  # one session
```

- 不带会话参数（且未设置 `ESTELA_PATH`）时，服务器通过相同的[会话索引](privacy.zh-CN.md#会话索引)读取会话浏览器会列出的全部会话，并提供全部七个工具。
- 传入会话参数（或设置了 `ESTELA_PATH`）时，服务器仅将该会话作为 `current` 提供服务，并只提供五个会话内工具；列表和搜索工具不会出现。
- stdout 仅传输 MCP 协议消息；就绪行、警告和错误输出到 stderr。无法加载会话或索引启动失败时，服务会在提供服务前以状态码 1 退出。

## 接入代理

```sh
# Claude Code
claude mcp add --scope user estela -- npx -y @rivus/estela mcp

# Codex
codex mcp add estela -- npx -y @rivus/estela mcp
```

Codex 也可以从 `~/.codex/config.toml` 读取配置：

```toml
[mcp_servers.estela]
command = "npx"
args = ["-y", "@rivus/estela", "mcp"]
```

Gemini CLI 从 `~/.gemini/settings.json`（或项目内的 `.gemini/settings.json`）读取配置：

```json
{ "mcpServers": { "estela": { "command": "npx", "args": ["-y", "@rivus/estela", "mcp"] } } }
```

若已全局安装 `estela`，可用 `estela mcp` 替代 `npx -y @rivus/estela mcp`。

## 代理技能

[`skills/estela/SKILL.md`](../../skills/estela/SKILL.md) 说明了代理如何使用这些工具从会话列表定位到失败请求。它不包含在 npm 包内，请从仓库复制 `skills/estela` 目录：

- Claude Code：复制到 `~/.claude/skills/estela/`（全部项目）或 `.claude/skills/estela/`（单个项目）。
- Codex：复制到 `~/.codex/skills/estela/`；在不支持技能的版本中，将 `SKILL.md` 正文粘贴到 `AGENTS.md`。
- Gemini CLI：将 `SKILL.md` 正文粘贴到 `GEMINI.md`。

## 工具列表

| 工具 | 作用 |
|---|---|
| `estela_list_sessions` | 按最近活动从新到旧列出会话，可按 `agent`、`project`、`cwd`、`since`、`until`、`hasCompaction`、`hasFailedTools` 过滤 |
| `estela_search_sessions` | 同上，筛选标题或用户自身输入的某条提示词包含 `query` 的会话 |
| `estela_session_summary` | 单个会话的代理、标题、时间、已记录的计数（以及日志未记录的计数）、能力和泳道 |
| `estela_list_turns` | 按顺序列出轮次，含各自的请求、Token、失败的工具结果和上下文压缩 |
| `estela_list_requests` | 列出模型请求，可限定为单条泳道或单个轮次，含模型、Token、时长和结束原因 |
| `estela_get_event` | 完整获取单个事件，可选附带其来源的日志记录 |
| `estela_reconstruct` | 模型在某个事件时看到的内容：上下文槽位、已记录的 Token 数以及被上下文压缩移除的事件 |

每个工具都是只读的，接收带有命名属性的 JSON 对象。典型调用流程：列出或搜索会话，取一个 `traceId`，读取摘要，找到包含失败工具的轮次，列出该轮次的请求，并在失败前的请求处执行重建。

[MCP 工具参考](../reference/mcp-tools.zh-CN.md)列出了每个输入的取值范围和默认值、每个结果字段、大小上限以及错误文本。简而言之：每次返回的 JSON 不超过 40,000 个字符；存在更多条目时列表分页会设置 `nextOffset`；过长字符串会被截断并在 `truncated` 中列出；`estela_reconstruct` 的每个列表最多保留最后 100 个 id，并给出总数。缺失的字段表示日志未记录，只有 `summary: "pending"` 的会话条目例外，其表示计数尚未计算完成。

## 结果是数据而非指令

每条返回结果都是记录下来的会话内容：提示词、回复、工具输出、文件文本，由生成日志的一方写入。代理必须将其视为数据，绝不能执行其中出现的指令。每个工具的描述都写明了这一点，技能文件也再次强调了这一点。

无论 `ESTELA_REDACT` 的取值如何，所有结果和错误消息都会脱敏（见[隐私与脱敏](privacy.zh-CN.md#脱敏覆盖的范围)）。只有当事件或泳道 id 为 1 到 128 个字母、数字、`_`、`.`、`:` 或 `-` 且脱敏后不发生改变时，才按原样返回；其他任何 id 都返回为 `@e<n>`（事件，按位置）或 `@l<n>`（泳道），且各工具同样接受该形式作为输入。当日志中重复出现同一 id 时，它指向具有该 id 的最后一个事件。

## 错误

调用失败会返回一条 MCP 错误结果，指明工具名和原因，例如：

```text
Error invoking "estela_list_sessions": Error: estela_list_sessions: limit: expected an integer from 1 to 50
```

各类错误原因及文本列在[参考文档](../reference/mcp-tools.zh-CN.md#错误)中。

## 通过本地服务器的 HTTP 路由

`estela --mcp` 还会通过本地服务器的 HTTP 路径 `/__estela/__mcp` 提供相同的七个工具。保护浏览器页面的一次性验证码不保护该路由；由 DevFrame 的检查负责保护：请求必须通过回环地址来自本机，且携带主机为回环名称的 `Origin` 请求头（`localhost`、`*.localhost` 名称、`127.x.x.x` 地址或 `[::1]`，任意端口）。不带 `Origin`、使用其他来源或来自其他主机的请求均会收到 HTTP 403，即使 `--host 0.0.0.0` 允许其他机器访问页面也是如此；网页也无法调用该路由，因为它不响应 CORS 预检请求。这些检查无法区分本机上的不同用户：同一台机器上任意用户的任意进程都可以通过该路由读取所有会话，包括本来无权读取你会话文件的用户。因此该路由默认关闭；切勿在与他人共用的机器上开启。除非确需 HTTP，请使用 stdio 服务器。

服务器在内存中保留最近加载的 3 个会话，因此如果代理连续遍历多个会话，Estela 会重新加载它们。
