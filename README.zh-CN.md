> 中文阅读版。以英文原文 README.md 为准。

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img src="docs/assets/logo.svg" width="96" height="96" alt="agent-trace">
</p>

<h1 align="center">agent-trace</h1>

<p align="center">
  <strong>Agent 会话日志的本地查看器</strong><br>
  会话浏览器 · 请求时间线 · 模型上下文重建
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rivus/agent-trace"><img src="https://img.shields.io/npm/v/@rivus/agent-trace?style=flat-square" alt="npm 版本"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@rivus/agent-trace?style=flat-square" alt="Node.js 24 或更高版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/@rivus/agent-trace?style=flat-square" alt="GPL-3.0-only"></a>
</p>

agent-trace 将本机的 Agent 会话集中呈现在一个界面中。每个会话包含时间线、事件列表和 Token 用量；每个请求对应模型当时收到的上下文。

核心能力是请求级上下文重建。对任意请求，agent-trace 重建模型当时收到的上下文——系统提示词、工具、消息，以及被上下文压缩移除的事件。日志未记录的槽位标记为 `unavailable`，不作任何推测。

## 功能

- **会话浏览器。** 本机 Agent 会话的集中列表：按天分组、最近活动在前。每行包含 Agent、标题、项目、轮次、请求、Token、时长、最近活动，以及上下文压缩、子代理和失败的工具调用标记。支持按 Agent、项目和标记筛选，按标题和用户提示词搜索，并提供所选会话的上下文变化预览。
- **会话工作区。** 会话指标、请求时间线、事件列表和事件检查器。时间线中每个请求对应一个柱形（高度为输入 Token），每个子代理对应一条泳道，并标注提示词、失败的工具调用和上下文压缩；事件列表按轮次分组，检查器展示所选事件详情。
- **模型所见。** 所选请求的上下文重建：系统提示词、工具、消息，以及被上下文压缩移除的事件；日志未记录的槽位标记为 `unavailable`。
- **报告。** 单个会话工作区的脱敏静态导出：一个 `index.html` 文件，无需服务器，可直接从磁盘打开。
- **MCP。** `agent-trace mcp <path>`：通过 stdio 提供 `reconstruct` 工具。

两个页面的静态设计稿见 [`docs/design/`](docs/design/README.md)。

## 快速开始

需要 Node.js 24 或更高版本：

```sh
npx @rivus/agent-trace
```

它会在 `localhost:7392` 启动服务，自动打开浏览器，并索引受支持 Agent 的会话。`--no-open` 只打印 URL；`--port 0` 选择空闲端口。

从源码构建需要 Node.js 24.x；构建出的 CLI 可在 Node.js 24 或更高版本运行：

```sh
pnpm install
pnpm build
node apps/cli/dist/bin.mjs
```

## 命令

```sh
npx @rivus/agent-trace [path] [--port <n>] [--host <host>] [--no-open] [--no-auth] [--pick] [--no-index]
npx @rivus/agent-trace build [path] [--out-dir <dir>]
npx @rivus/agent-trace mcp [path]
npx @rivus/agent-trace export-atif [path] [--out <file>]
npx @rivus/agent-trace export-otlp [path] [--out <file>]
```

| 命令 | 作用 |
|---|---|
| `agent-trace` | 本机的会话浏览器。 |
| `agent-trace <path>` | 在服务器开始监听前加载该会话（若没有适配器接受，会以退出码 1 退出并说明原因），然后打开它的工作区。 |
| `agent-trace --pick` | 在终端中可搜索的会话列表；按 Enter 打开选中的会话。需要交互式终端。 |
| `agent-trace build <path> --out-dir <dir>` | 把单个会话的报告写到 `<dir>/index.html`（默认 `dist-static`）。 |
| `agent-trace mcp <path>` | 通过 stdio 提供该会话的 MCP 服务，包含 `reconstruct` 工具。只有协议消息会写到 stdout。 |
| `agent-trace export-atif <path> --out <file>` | 将会话写成一条 [ATIF v1.8](https://github.com/harbor-framework/harbor/blob/main/rfcs/0001-trajectory-format.md) 轨迹（默认 `agent-trace-<session>.atif.json`），用于 Harbor 数据集和评估。 |
| `agent-trace export-otlp <path> --out <file>` | 将会话写成一个 OTLP/JSON `ExportTraceServiceRequest`（默认 `agent-trace-<session>.otlp.json`），其中的 span 携带 `gen-ai-dev/1.42.0-dev` 的 OpenTelemetry GenAI 属性，用于 Langfuse、LangSmith 和 Phoenix。 |

| 参数 | 含义 |
|---|---|
| `--port <n>` | 端口（默认 7392；`0` 表示自动选择空闲端口）。 |
| `--host <host>` | 绑定地址（默认 `localhost`）。 |
| `--no-open` | 只打印 URL，不打开浏览器。 |
| `--no-auth` | 关闭 DevFrame 的一次性验证码。默认打开的 URL 会带上验证码。 |
| `--pick` | 在终端中选择会话。 |
| `--no-index` | 不读写会话索引；每次启动重新计算摘要，不存储。 |

`AGENT_TRACE_PATH` 是默认的会话路径。没有给路径时，`build`、`mcp` 和导出命令会回退到内置的演示 trace。输出不是终端，或设置了 `NO_COLOR` 时，CLI 会打印不带转义序列的纯文本行。

## 会话导出

`export-atif` 和 `export-otlp` 将规范 trace 映射为两种交换格式。每个 step 或 span 都会标明它来自哪些规范事件（ATIF 中为 `extra.agent_trace.eventIds`），因此可以从导出结果追溯到工作区。

```sh
# Harbor datasets and evaluation (ATIF v1.8)
npx @rivus/agent-trace export-atif <path> --out trajectory.json
python -m harbor.utils.trajectory_validator trajectory.json   # Harbor's validator

# Langfuse (OTLP/JSON goes up as is)
curl -H "Content-Type: application/json" -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  --data-binary @agent-trace-<session>.otlp.json https://cloud.langfuse.com/api/public/otel/v1/traces

# LangSmith or Phoenix (OTLP/protobuf receivers: convert once, then post)
uv run --with opentelemetry-proto python -c \
  "from google.protobuf.json_format import Parse; from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest as R; import sys; sys.stdout.buffer.write(Parse(open(sys.argv[1],'rb').read(), R()).SerializeToString())" \
  agent-trace-<session>.otlp.json > session.otlp.pb
curl -H "Content-Type: application/x-protobuf" --data-binary @session.otlp.pb http://localhost:6006/v1/traces
```

导出和服务器一样进行脱敏（home 目录替换为 `~`，已知凭据模式被替换）；`AGENT_TRACE_REDACT=0` 会写出未脱敏的字节。被上下文压缩移除的事件不生成 ATIF step；跨压缩保留的 step 标记为 `is_copied_context`，压缩本身是携带 `extra.context_management` 的 system step。

## 把会话带到别处

`export-atif` 和 `export-otlp` 把规范 trace 投影成两种交换格式。每个 step/span 都标出来源事件（ATIF 的 `extra.agent_trace.eventIds`），导出后可以追回 workspace。

```sh
# Harbor datasets and evaluation (ATIF v1.8)
npx @rivus/agent-trace export-atif <path> --out trajectory.json
python -m harbor.utils.trajectory_validator trajectory.json   # Harbor's validator

# Langfuse (OTLP/JSON goes up as is)
curl -H "Content-Type: application/json" -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" \
  --data-binary @agent-trace-<session>.otlp.json https://cloud.langfuse.com/api/public/otel/v1/traces

# LangSmith or Phoenix (OTLP/protobuf receivers: convert once, then post)
uv run --with opentelemetry-proto python -c \
  "from google.protobuf.json_format import Parse; from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest as R; import sys; sys.stdout.buffer.write(Parse(open(sys.argv[1],'rb').read(), R()).SerializeToString())" \
  agent-trace-<session>.otlp.json > session.otlp.pb
curl -H "Content-Type: application/x-protobuf" --data-binary @session.otlp.pb http://localhost:6006/v1/traces
```

导出会像服务端一样脱敏（home 目录显示为 `~`，已知凭证模式会被替换）；`AGENT_TRACE_REDACT=0` 会写出未脱敏内容。被 compaction 移除的事件不会生成 ATIF step；跨越 compaction 保留的 step 会标 `is_copied_context`，compaction 本身是一个带 `extra.context_management` 的 system step。

## 支持的 Agent

| Agent | 会话位置 |
|---|---|
| Claude Code | `~/.claude/projects/` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`、`~/.codex/archived_sessions/**/rollout-*.jsonl` |
| DeepSeek Harness | `~/.dsh/sessions/<cwd>/<session-id>/session.v4.jsonl.zstd` |
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Pi | `~/.pi/agent/sessions/<cwd>/<time>_<id>.jsonl` |

- 各 Agent 的 home 环境变量会替换默认 home：Claude Code 用 `CLAUDE_CONFIG_DIR`，Codex 用 `CODEX_HOME`，DeepSeek Harness 用 `DSH_HOME`，Grok 用 `GROK_HOME`，OpenCode 用 `XDG_DATA_HOME`，Pi 用 `PI_CODING_AGENT_DIR`。设置 `CLAUDE_CONFIG_DIR` 后，只位于 `~/.claude` 下的会话不会被列出。
- Agent 目录不存在时会显示 0 个会话，并给出它检查过的路径。适配器无法解析的文件会列为“无法读取”，并给出文件、行号和原因。会话中不是 JSON 的行会被跳过，不会让整个会话失败。
- Grok 只按轮次记录 Token 用量，所以 Grok 会话每轮只有一个请求，而不是每次模型调用一个请求。

## 隐私

- 所有处理都在本机完成。服务器只绑定 `localhost`，不会把任何内容发送到别处。
- 会话文件只读，不写入。
- 会话索引位于 `$XDG_CACHE_HOME/rivus-agent-trace/index.sqlite`（默认 `~/.cache/rivus-agent-trace/`），权限为 0600。它保存标题、路径、数字，以及用户输入的前 200 条提示词（每条 500 字符）用于搜索——不保存 Agent 注入或 Agent 自己记录的文本。可以随时删除；它会从日志重建。`--no-index` 可以在没有索引的情况下运行。
- URL 只携带不透明的 trace id，从不包含路径。
- 本地服务器会把 home 目录替换成 `~`，并把已知的凭据模式替换成占位符；`AGENT_TRACE_REDACT=0` 只对本地服务器关闭这一行为。
- 报告（`build`，或工作区里的“导出报告”）无论 `AGENT_TRACE_REDACT` 如何设置，都会按同样的方式脱敏。**报告仍保留会话文本和文件内容，分享前请先阅读。** 报告包含每个事件的视图，以及前 2,000 个事件或 20 MB（取较小者）的原始记录；如果实际更少，报告头部会说明。

## 开发

仓库是 pnpm workspace。UI 使用 Solid、Tailwind v4 和 shadcn-solid；构建、lint、格式化和测试都通过 Vite+（`vp`）运行。

- [架构](docs/architecture/overview.md)：当前行为和系统结构。
- [视觉设计](docs/design/README.md)：页面、设计 token 和 logo。
- [开发环境](docs/development/setup.md)：本地命令、tarball，以及 smoke 和浏览器测试套件。
- [贡献指南](CONTRIBUTING.md)：工作流、变更门槛和发布意图。
- [安全](SECURITY.md)：如何报告漏洞。

```sh
pnpm install
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

## 许可证

GPL-3.0-only。见 [LICENSE](LICENSE)。

---

_本项目与 [Cursor 的 Agent Trace](https://agent-trace.dev)（一种代码归属格式）没有关联。_
