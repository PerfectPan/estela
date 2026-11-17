> 中文阅读版。以英文原文 docs/guide/getting-started.md 为准。

<!-- source-blob: f8f35867a53fc9a5e7ce13eca5ee8ed592b7e325 -->

# 入门

## 运行方式

Estela 需要 Node.js 24 或更高版本，可在 macOS、Linux 和 Windows 上运行。无需安装即可直接运行：

```sh
npx @rivus/estela
```

或者一次性全局安装 `estela` 命令：

```sh
npm install -g @rivus/estela
estela
```

该命令读取每个受支持代理的会话目录（没有会话的代理会显示它检查过的目录），启动本地服务器，并打开浏览器。服务器默认监听 `localhost:7392`；当 7392 被占用时，监听下一个空闲端口。打开的 URL 带有一次性验证码，用于授权该浏览器访问；其他浏览器需要输入终端打印的验证码。当输出不是终端时，进度会以如下纯文本行输出：

```text
estela 0.2.0
Claude Code: 12/12 files read
Codex: 0 files, checked ~/.codex/sessions, ~/.codex/archived_sessions
...
Ready: http://localhost:7392/__estela/#/
```

按 Ctrl-C 停止服务器。常用选项：

| 选项 | 作用 |
|---|---|
| `--no-open` | 打印 URL，不打开浏览器 |
| `--port <n>` | 监听指定端口；`--port 0` 自动选择任意空闲端口 |
| `--host <host>` | 绑定除 `localhost` 之外的地址（使用前请阅读[隐私与脱敏](privacy.zh-CN.md)） |
| `--no-index` | 不读取也不写入[会话索引](privacy.zh-CN.md#会话索引) |

`estela --help` 和 `estela <command> --help` 列出全部参数和选项。完整列表见[公共接口](../reference/public-interface.zh-CN.md#命令行)。

## 首屏：会话浏览器

不带会话参数启动时，Estela 打开会话浏览器。它列出为[支持的代理](supported-agents.zh-CN.md)找到的每一个会话，按最近活动从新到旧排列并按天分组。

- 左侧栏列出每个代理及其会话数，未找到会话时列出检查过的目录。下方是项目列表（各会话工作目录的最后一级文件夹）和「只显示」标记：含上下文压缩、有子代理、有失败的工具调用。
- 每一行显示代理、标题、项目、轮次、请求、Token、时长和最近活动，并标出上下文压缩、子代理和失败的工具调用标记。
- 搜索框匹配会话标题和你自己输入的提示词，不搜索代理的回复、工具输出或文件内容。
- 选中一行会显示预览：该会话的各项数字、首条提示词以及上下文大小变化图。打开会话后进入[工作区](workspace.zh-CN.md)。

Estela 在后台按从新到旧的顺序读取会话时，数字会逐步填充；列表会提示当前仍在读取的会话数量。下次启动时，这些数字会直接从[会话索引](privacy.zh-CN.md#会话索引)读取并立即显示。

Estela 无法读取的文件仍会出现在列表中，标记为「无法读取」，并附带文件、行号和原因（见[故障排查](troubleshooting.zh-CN.md#显示无法读取的会话)）。

## 打开单个会话

传入会话路径即可直接打开该会话的工作区：

```sh
estela ~/.claude/projects/my-app/0f8c2f1e-....jsonl
estela ~/.local/share/opencode/opencode.db#ses_123abc
```

参数可以是会话文件、用于包含多个会话的文件或数据库的 `path#sessionId`（OpenCode 总是采用这种形式），或规范 Estela JSON trace。Estela 会在服务器启动前加载它；如果没有代理读取器能识别该文件，则打印原因并以状态码 1 退出。也可以通过环境变量 `ESTELA_PATH` 设置相同参数。

## 在终端中选择会话

```sh
estela --pick
```

`--pick` 在终端中显示可搜索的会话列表。输入标题的一部分即可筛选，按 Enter 在浏览器中打开选中的会话。该选项需要交互式终端，且不能与会话路径同时使用；违反任一条件都会以状态码 1 退出。

## 下一步

- [概念](concepts.zh-CN.md)说明工作区中使用的术语。
- [工作区](workspace.zh-CN.md)说明各个面板和数字的含义。
