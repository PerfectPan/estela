> 中文阅读版。以英文原文 docs/guide/README.md 为准。

<!-- source-blob: 4e229f9114394c8df628094557d523bc9b474e2c -->

# 用户指南

Estela 读取代理保存在你本机上的会话日志，并在本地网页中展示：在一个列表中汇总所有会话，并在单个会话中展示其请求、事件、Token 数、目录价费用以及模型在每个请求时收到的上下文。

如果是初次使用，建议按以下顺序阅读：

1. [入门](getting-started.zh-CN.md)：安装、运行、打开会话。
2. [概念](concepts.zh-CN.md)：会话、轮次、请求、事件、泳道、上下文压缩、「模型所见」以及 `unavailable`。
3. [工作区](workspace.zh-CN.md)：时间线、事件列表、检查器标签页、对比以及费用。

之后可根据需要阅读：

- [支持的代理](supported-agents.zh-CN.md)：各代理会话的存放位置，以及各代理日志记录的内容。
- [报告与导出](exports.zh-CN.md)：用于分享的静态报告，以及供其他工具使用的 ATIF 和 OTLP 文件。
- [MCP 工具](mcp.zh-CN.md)：让代理检查先前的会话。
- [DeepSeek Harness 插件](dsh-plugin.zh-CN.md)：无需运行 CLI，直接在 `dsh web` 中查看当前会话。
- [隐私与脱敏](privacy.zh-CN.md)：留在本地的内容、脱敏覆盖的范围，以及报告中仍保留的内容。
- [故障排查](troubleshooting.zh-CN.md)：Node 版本、端口、无法读取的文件、索引缓存。

参考文档：[命令行与公共接口](../reference/public-interface.zh-CN.md)、[导出格式](../reference/export-formats.zh-CN.md)、[MCP 工具](../reference/mcp-tools.zh-CN.md)。
