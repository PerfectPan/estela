> 中文阅读版。以英文原文 docs/specs/0001-external-release.md 为准。

# Spec 0001：agent-trace DevTools

## 状态

已实现

配套 Plan：[`docs/plans/0001-external-release.md`](../plans/0001-external-release.md)

视觉设计：[`docs/design/`](../design/README.md)

## 问题与范围

使用 coding agent 的开发者难以看到 agent 在一个会话中做了什么，也难以看到模型在某次请求时被展示了什么。日志存在于开发者的机器上，但每个 host 写入的格式不同，而原始 JSONL 文件隐藏了请求边界、上下文大小、压缩和 subagent。

agent-trace 是一个本地 DevTools。一条命令即可在浏览器中打开它。开发者从任一受支持的 host 中选择一个会话，并在一个屏幕上调试它：一个展示请求和上下文大小的 timeline，一个按轮次分组的事件 ledger，以及一个展示模型在所选请求时所见内容的 inspector。

范围内：

- `npx @rivus/agent-trace` 在默认浏览器中打开 DevTools。
- 一个会话浏览器，列出在本机上为受支持 host 找到的会话。
- 一个会话工作区：头部数字、timeline、ledger、inspector。
- 本次发布支持的 host：Claude Code、Codex、Grok。每个 host 通过同一个 host 协议接入。
- 单个会话的脱敏静态报告。
- 深色和浅色主题。
- 英文和简体中文 UI。
- 带样式的终端体验：启动、进度、本地 URL、错误，以及一个终端会话选择器。
- 一个向其他 agent 暴露 `reconstruct` 的 MCP server。

范围外：

- 会话浏览器中的 OpenCode 和 dsh。它们作为后续 host 基于同一协议接入。
- ATIF 或 OTLP 导出。
- 对仍在运行的会话的实时跟随。
- 编辑、回放或重新运行会话。
- 账号、上传或托管服务。
- 内部包的稳定库 API。
- 发布到 npm registry。本次发布通过打包后的 tarball 验证。

## 行为要求

### 启动行为

- `npx @rivus/agent-trace` 必须在 `localhost` 上启动一个 server，并在默认浏览器中打开会话浏览器。`--no-open` 必须跳过打开浏览器并打印 URL。
- `npx @rivus/agent-trace <path>` 必须直接打开该会话的会话工作区。
- 不存在的路径，或没有任何受支持 host 接受的路径，必须在 server 开始监听前以 1 退出，并给出指明该路径的消息。
- 在低于 22.18 的 Node.js 上，该命令必须退出，并给出指明所需版本的消息。

### 终端输出

- 在终端中，CLI 必须显示带名称和版本的启动头部；在索引会话时和加载会话时显示进度；在一个高亮块中显示本地 URL，终端支持时显示为可点击链接；显示错误时给出原因和一行修复方法。
- 当输出不是终端，或设置了 `NO_COLOR` 时，CLI 必须打印纯文本行：没有颜色代码、没有光标控制、没有动画。
- `npx @rivus/agent-trace --pick` 必须在终端中打开一个可搜索的会话列表，并在浏览器中打开所选会话。没有交互式终端时，它必须以 1 退出，并给出说明 `--pick` 需要交互式终端的消息。
- `mcp` 必须只向 stdout 写入协议消息。它自己的消息写入 stderr。

### 会话浏览器

- 会话浏览器必须列出来自本机上每个受支持 host 默认位置的会话，按最新活动优先排序，按天分组。
- 打开后 2 秒内必须出现行，即使各 host 保存了数千个会话和数 GB 的日志。需要完整读取会话文件的数字在计算完成时填入，并在多次运行之间缓存，因此下一次启动时会立即显示。
- 每一行必须显示 host、标题、项目目录、轮次、请求、token、时长、最后活动，以及压缩、subagent 和失败工具调用的标记。host 日志未记录的值必须显示为 "—"，而不是零。
- 默认位置不存在的 host 必须以计数 0 和所检查的路径出现。这不是错误。
- adapter 无法解析的会话文件仍必须被列出，标记为 "could not read"，原因可在悬停时查看。它不得被静默隐藏。
- 列表必须可按 host、项目和这三个标记过滤，并可按标题和每一条用户 prompt 的文本搜索，支持英文和中文。
- 选中一行必须显示预览：上下文随时间变化的形状、主要数字和首个 prompt。

### 会话工作区

- 头部必须显示 host、工作目录、开始时间、标题、时长、轮次、请求、输入和输出 token、压缩、subagent 和失败工具调用。
- timeline 必须为每次模型请求绘制一根柱，其高度为该请求的输入 token；每个 subagent 一条泳道；每个用户 prompt 处一个标记；每个失败工具调用处一个标记；每次压缩处一条虚线，在 host 有记录时标注压缩前后的 token 数。
- 在 timeline 上拖选一个范围必须将 ledger 过滤到该范围。范围手柄还必须可以获得焦点，并能用方向键移动。
- ledger 必须按轮次对事件分组。轮次必须可折叠和展开。hook 事件必须对每一段连续的 hook 折叠为一行。一个开关必须将压缩后模型不再看到的事件调暗。
- 对于至少 10,000 个事件的会话，ledger 必须保持响应。
- 至少 350 MB 的会话文件必须能够打开。工作区必须显示加载进度，且浏览器不得接收整个文件：长文本在 ledger 中被缩短并带有可见标记，完整文本和原始记录在选中该事件时加载。
- 选中一个请求必须打开 inspector。其 "Model saw" 标签页必须显示该请求时的上下文组成（system prompt、工具、摘要、消息、当前轮次），在已知时附带 token 数，以及在它之前被压缩移除的事件。host 未记录的槽位必须标注为 "unavailable"。它不得被估算。
- 选中任意事件必须显示其规范化字段，并在 "Raw" 中显示 host 的原始记录。

### 报告

- 工作区中的 "Export report"，以及 `npx @rivus/agent-trace build <path> --out-dir <dir>`，必须写出一个单会话的静态报告，该报告无需 server 即可打开。
- 报告必须始终脱敏：分享者的 home 目录变为 `~`，已知的 token 模式被替换。`AGENT_TRACE_REDACT=0` 不得影响报告。

### MCP

- `npx @rivus/agent-trace mcp <path>` 必须通过 stdio 将该会话的 `reconstruct` 作为 MCP 工具提供。

### 主题

- UI 必须跟随系统配色方案，并提供一个在浏览器中持久保存的手动深色和浅色切换。

### 语言

- UI 必须提供英文和简体中文两种语言。
- 首次加载时，浏览器首选语言为中文则 UI 必须使用简体中文，否则使用英文。手动的语言切换必须在浏览器中持久保存。
- 日期、时间、时长和数字必须按所选语言格式化。token 数在两种语言中都保留 `k` 和 `M` 缩写。
- 会话内容必须按原样显示，不做翻译：提示词、回复、工具参数和输出、文件路径、命令、模型名称，以及原始记录。
- 报告必须以导出时所选的语言打开，并保留语言切换。
- 本版本中 CLI 和 MCP 的输出保持英文。

## 领域不变量

- 规范 trace 是有序事件，每个事件始终可以返回其原始 host 记录。轮次、请求、泳道和统计数据是它的投影。
- 缺失的数据是 `unavailable`。任何屏幕都不虚构值、边界或事件。
- 每条 host 记录要么由一个事件表示，要么被计为已跳过并附带原因。没有任何内容被静默丢弃。
- 两次加载同一文件得到相同的事件 id。
- 会话文件只被读取，从不被写入。

## 验收示例

### S1：DevTools 的打开

- Given Node.js 22.18，以及位于各自默认位置的 Claude Code、Codex 和 Grok 会话
- When 用户运行 `npx @rivus/agent-trace`
- Then 浏览器打开会话浏览器，其中列出来自全部三个 host 的会话，并附带每个 host 的计数

### S2：单个会话的直接打开

- Given 一个 Claude Code 会话文件的路径
- When 用户运行 `npx @rivus/agent-trace <path>`
- Then 浏览器打开该会话的工作区

### S3：未安装的 host

- Given 不存在 `~/.codex` 目录
- When 会话浏览器加载
- Then Codex 显示 0 个会话和所检查的路径，其他 host 正常加载

### S4：无法读取的会话

- Given 一个会话文件，其记录使用未知的格式代
- When 会话浏览器加载
- Then 该行被列为 "could not read"，打开它会显示 host、文件，以及第一条无法读取记录的行号

### S5：timeline 中的压缩

- Given 一个包含一次自动压缩的 Claude Code 会话
- When 用户打开它
- Then timeline 显示逐渐升高的请求柱、一条标注压缩前后 token 数的虚线，以及其后较低的柱

### S6：刷选范围对 ledger 的过滤

- Given 一个已打开的会话
- When 用户在 timeline 上拖选一个范围
- Then ledger 只显示该范围内的事件，timeline 的头部说明该范围和事件数

### S7：Model saw

- Given Claude Code 会话中压缩之后的第一个请求
- When 用户选中它并打开 "Model saw"
- Then 组成中显示摘要、消息和当前轮次，并在 host 有记录时显示 token 数；system prompt 和工具槽位为 "unavailable"（Claude Code 两者都不记录）；并显示被该次压缩移除的事件列表

### S8：大型会话

- Given 一个包含 10,000 个事件的会话
- When 用户将 ledger 从顶部滚动到底部
- Then 滚动保持流畅，页面持有的已渲染行数有上限

### S9：报告

- Given 一个已打开的会话
- When 用户导出报告并从磁盘打开 `index.html`
- Then 工作区在没有 server 的情况下渲染，且报告中没有任何文件包含 home 目录

### S10：MCP reconstruct

- Given 一个会话路径
- When 一个 MCP client 列出工具并以一个事件 id 调用 reconstruct
- Then 结果列出可见的事件 id、不可用的槽位和完整度

### S11：主题

- Given 系统设置为浅色模式
- When 用户打开 DevTools，然后切换到深色并重新加载
- Then 首次加载为浅色，重新加载后为深色

### S12：超大会话

- Given 一个 350 MB 的 Codex 会话文件
- When 用户打开它
- Then 工作区在进度指示之后渲染，长的工具输出显示 "shortened" 标记，选中其中一个会加载其完整文本和原始记录

### S13：旧版 Node.js

- Given Node.js 20
- When 用户运行 `npx @rivus/agent-trace`
- Then 用户看到一条指明 Node.js 22.18 的消息，而不是模块加载器的堆栈跟踪

### S14：语言

- Given 浏览器的首选语言为 `zh-CN`
- When 用户打开 DevTools，然后切换到英文并重新加载
- Then 首次加载显示中文标签和中文日期格式，会话内容不变，重新加载后 UI 为英文

### S15：管道输出时的纯文本输出

- Given 未设置 `NO_COLOR`，且输出通过管道写入文件
- When 用户运行 `npx @rivus/agent-trace build <path> --out-dir report > log.txt`
- Then `log.txt` 包含可读的进度行和结果行，且没有转义序列

### S16：终端选择器

- Given 一个交互式终端，以及来自三个 host 的会话
- When 用户运行 `npx @rivus/agent-trace --pick`，输入标题的一部分，并按下 Enter
- Then 浏览器打开所选会话的工作区

## 兼容性与约束

- 公共接口：上述 CLI 命令和参数。规范 trace 文件格式和包的导出尚不稳定，其变更不提供兼容层。
- 持久化数据：浏览器存储中的主题和语言选择，以及用户缓存目录中的会话索引（`$XDG_CACHE_HOME/rivus-agent-trace/`，默认 `~/.cache/rivus-agent-trace/`）。删除索引始终是安全的；索引会从日志重建。
- 配置：`AGENT_TRACE_PATH` 继续作为默认会话路径生效。`AGENT_TRACE_REDACT=0` 只影响本地 server。
- 运行边界：本地工具，默认绑定 `localhost`。会话浏览器只读取构建每一行所需的内容。

## 验收证据

- S1、S3、S4、S5、S6、S7、S9、S11、S14：针对合成 fixture home 的浏览器端到端测试，在 CI 中基于打包后的 tarball 运行。
- S2、S10、S13、S15：基于打包后的 tarball 的 CLI 冒烟测试。
- S16：基于打包后的 tarball 的伪终端测试（`node-pty` 仅用于测试 harness）。
- S8：一个生成的 10,000 事件 trace，并断言已渲染的行数。
- S12：一个在测试时构建的 350 MB Codex 格式 fixture（不提交），并断言发送到浏览器的 payload 大小。
- 真实会话：每个 host 一次本地运行，在交付 PR 中记录为 host、命令、事件数和加载时间。会话文件不提交。
