> 中文阅读版。以英文原文 docs/guide/supported-agents.md 为准。

# 支持的代理

Estela 读取七个代理的日志。读取器位于 [`@rivus/agent-kit`](https://www.npmjs.com/package/@rivus/agent-kit) 0.24.1 中，已打包进 CLI。

## 会话位置

| 代理 | 默认位置 | 主目录覆盖变量 |
|---|---|---|
| Claude Code | `~/.claude/projects/` | `CLAUDE_CONFIG_DIR` |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl`、`~/.codex/archived_sessions/**/rollout-*.jsonl` | `CODEX_HOME` |
| DeepSeek Harness | `~/.dsh/sessions/<cwd>/<session-id>/session.v4.jsonl.zstd` | `DSH_HOME` |
| Gemini CLI | `~/.gemini/tmp/**/chats/*.jsonl`，以及没有同目录 `.jsonl` 文件的旧版 `*.json` 对话 | `GEMINI_CLI_HOME` |
| Grok | `~/.grok/sessions/<cwd>/<session-id>/` | `GROK_HOME` |
| OpenCode | `~/.local/share/opencode/opencode.db` | `XDG_DATA_HOME` |
| Pi | `~/.pi/agent/sessions/<cwd>/<time>_<id>.jsonl` | `PI_CODING_AGENT_DIR` |

在 Estela 运行环境中设置了主目录覆盖变量时，它会替换对应代理的默认主目录，行为与代理自身一致。设置 `CLAUDE_CONFIG_DIR` 后，仅存在于 `~/.claude` 下的会话不会被列出。

Claude Code 的子代理文件会显示在其父会话中。一个 OpenCode 数据库包含多个会话，每个会话按 `opencode.db#<sessionId>` 打开。无论会话文件位于何处，也可以通过路径直接打开（见[入门](getting-started.zh-CN.md#打开单个会话)）。

目录不存在的代理会显示 0 个会话，并列出 Estela 检查过的目录。不在此表中的代理不会被读取。

## 各代理记录的内容

Estela 能展示什么取决于代理写入日志的内容。下表依据各读取器声明的能力，以及 `packages/server/src/sessions/conformance.test.ts` 所运行的 `fixtures/sessions/<agent>/` 下的一致性测试夹具整理。「未记录」表示该代理的日志不保存相应数据，因此该代理的所有会话在对应视图中均显示 `unavailable` 或「—」。

| 代理 | 系统提示词 | 工具定义 | 用量 | 缓存 Token 类别 | 子代理 | 上下文压缩 | 时长 | 钩子 |
|---|---|---|---|---|---|---|---|---|
| Claude Code | 来自提示词快照（Claude Code 2.1.268 及更高版本） | 来自提示词快照（2.1.268 及更高版本） | 按请求 | 读取、写入（5 分钟和 1 小时） | 是 | 是，含压缩前后 Token 数 | 是 | 是 |
| Codex | 当 rollout 有记录时（较旧的 rollout 不记录） | 未记录 | 按请求 | 读取，有记录时含写入 | 是 | 是，不含 Token 数 | 是 | 未记录 |
| DeepSeek Harness | 是 | 是 | 按请求 | 读取、写入 | 未记录 | 是，含 Token 数 | 未记录 | 未记录 |
| Gemini CLI | 未记录 | 未记录 | 按请求 | 仅读取 | 未记录 | 是，含 Token 数 | 未记录 | 未记录 |
| Grok | 当会话目录包含提示词文件时 | 当会话目录包含工具文件时 | 按轮次（见下文） | 读取、写入 | 是 | 是，含 Token 数 | 是 | 是 |
| OpenCode | 未记录 | 未记录 | 按请求 | 读取、写入 | 未记录 | 未记录 | 未记录 | 未记录 |
| Pi | 未记录 | 未记录 | 按请求 | 读取、写入 | 未记录 | 是，含 Token 数 | 未记录 | 未记录 |

所有代理都会记录请求、Token 用量以及模型产生的推理文本。只要代理记录了缓存读取和缓存写入类别，请求的输入 Token 就包含这些类别。

当日志未记录系统提示词或工具定义时，[模型所见](concepts.zh-CN.md#模型所见)中的对应槽位显示为 `unavailable`，[对比](workspace.zh-CN.md#对比)也不会对它们进行比较。

## 已知限制

- **Grok 仅按轮次记录用量。** 每个 Grok 请求覆盖整整一轮（包括其中多次模型调用以及在轮次内完成的子代理），因此一个 Grok 会话中每轮只有一条请求，而不是每次模型调用一条。Grok 也会在日志中记录自己的每轮费用；Estela 改为显示已记录 Token 的目录价（[费用](workspace.zh-CN.md#费用)）。
- **不显示代理自行记录的费用。** OpenCode、Pi 和 Grok 会记录各自的费用，Codex 会记录优先服务等级的倍率。读取器尚未将这些信息传递给查看器，因此 Estela 显示的费用可能与这些代理自身记录的金额不同。
- **新日志格式会被拒绝而不是猜测。** 当代理新版本以读取器未知的方式更改日志格式时，会话会显示「无法读取」以及文件、行号和原因，而不会展示不完整的会话。待 Estela 发布包含更新读取器的新版本后即可恢复读取（见[故障排查](troubleshooting.zh-CN.md#显示无法读取的会话)）。
- **单行错误会被跳过。** 不是 JSON 的行会被跳过并计入统计，会话的其余部分仍会正常加载。
