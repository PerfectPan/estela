import type { Dictionary } from './dictionary.en.ts'

// Product names (Estela, Claude Code, Model saw in the UI is 模型所见), commands, flags, paths, and format names
// stay as written in README.zh-CN.md.

export const zhCN = {
  meta: {
    title: 'Estela：看清模型在每次请求时看到了什么',
    description: 'Agent 会话的本地查看器。从本机日志重建请求时间线、事件列表、目录价费用，以及每个请求收到的上下文。',
  },
  nav: {
    label: '主导航',
    skip: '跳到正文',
    features: '功能',
    demo: '演示',
    agents: 'Agent',
    privacy: '隐私',
    docs: '文档',
    language: '语言',
    footer: '页脚',
    themeToDark: '切换到深色主题',
    themeToLight: '切换到浅色主题',
  },
  hero: {
    eyebrow: 'Agent 会话的本地查看器',
    titleLead: '看清模型在每次请求时',
    titleTail: '看到了什么。',
    lead: 'Estela 把本机的 Agent 会话集中到一个本地界面：每个会话有请求时间线、事件列表和 Token 用量，每个请求对应模型当时收到的上下文。',
    copy: '复制命令',
    copied: '已复制',
    demo: '打开在线演示',
    source: 'GitHub 源码',
    facts: ['Node.js 24 或更高版本', '默认绑定 localhost', '只读日志，从不写入', 'GPL-3.0-only'],
    scene: {
      label:
        '按 Estela 的画法绘制的一个会话：每个请求一根柱形，高度是输入 Token。上下文逐步增长，上下文压缩把它截断，两条子代理泳道从主泳道分出。',
      sample: '示例会话',
      context: '每个请求的输入 Token',
      compaction: '上下文压缩',
      lane: '子代理泳道',
      selected: '模型所见',
    },
  },
  answers: {
    eyebrow: '它回答的问题',
    title: '日志告诉你发生了什么。Estela 让你看到模型当时手里有什么。',
    items: [
      {
        id: 'saw',
        question: '这次请求时，模型看到了什么？',
        answer:
          '选中任意请求，Estela 重建它收到的上下文：系统提示词、工具、消息，以及被上下文压缩移除的事件。日志未记录的槽位标记为 unavailable，不作任何推测。',
      },
      {
        id: 'compaction',
        question: '上下文压缩移除了什么？',
        answer:
          '上下文压缩显示为一条虚线，标出压缩前后的 Token 数。模型所见会列出被移除的事件，对比可以显示同一通道任意两个请求之间进入和离开上下文的内容。',
      },
      {
        id: 'tokens',
        question: 'Token 和钱都花在了哪里？',
        answer:
          '时间线中每个请求一根柱形，高度为输入 Token，并标注提示词、失败的工具调用和上下文压缩。每个请求、每轮、每个子代理和整个会话都显示已记录 Token 的目录价费用；日志无法计价的请求标为不可用。',
      },
      {
        id: 'lanes',
        question: '每个子代理做了什么？',
        answer: '每个子代理在时间线中有自己的泳道。事件列表可以按轮次分组，也可以按代理分组，每个代理一个标题。',
      },
    ],
    figure: {
      system: '系统提示词',
      tools: '工具',
      messages: '消息',
      removed: '被上下文压缩移除',
      unavailable: 'unavailable',
      request: '请求',
      prompt: '提示词',
      failed: '失败的工具调用',
      main: '主代理',
      subagent: '子代理',
    },
  },
  demo: {
    eyebrow: '在线演示',
    title: '真实的报告，不是截图。',
    lead: '这是 build 命令用内置演示 trace 生成的文件：一个已脱敏的 index.html，无需服务器即可打开。点击一个请求，查看模型所见。',
    open: '在新标签页打开演示',
    frame: '内置演示 trace 的 Estela 报告',
    small: '报告是桌面端工具。请在更宽的屏幕上查看，或在新标签页打开。',
  },
  commands: {
    eyebrow: '一条命令',
    title: '运行它，然后选一个会话。',
    lead: '它在 localhost:7392 启动服务器，打开浏览器，并为支持的 Agent 建立会话索引。带上路径则直接打开那个会话。',
    rows: [
      { command: 'npx @rivus/estela', what: '本机的会话浏览器。' },
      { command: 'npx @rivus/estela <path>', what: '加载该会话，然后打开它的工作区。' },
      { command: 'npx @rivus/estela --pick', what: '在终端中搜索并选择会话。' },
      { command: 'npx @rivus/estela build <path>', what: '把一个会话的报告写成一个 index.html。' },
      { command: 'npx @rivus/estela mcp', what: '通过 stdio 提供的 MCP 服务器：七个只读工具，覆盖全部会话。' },
    ],
  },
  elsewhere: {
    eyebrow: '把会话带到别处',
    title: '导出，或让另一个 Agent 来问。',
    items: [
      {
        name: 'ATIF v1.8',
        command: 'npx @rivus/estela export-atif <path>',
        body: '一份 trajectory，用于 Harbor 数据集和评测。每个 step 标明它来自哪些规范事件。',
      },
      {
        name: 'OTLP/JSON',
        command: 'npx @rivus/estela export-otlp <path>',
        body: '一个 ExportTraceServiceRequest，span 带 OpenTelemetry GenAI 属性，可用于 Langfuse、LangSmith 和 Phoenix。',
      },
      {
        name: 'MCP',
        command: 'npx @rivus/estela mcp',
        body: '通过 stdio 提供七个只读工具，Agent 可以找到之前的会话，并读取某次请求时模型看到了什么。',
      },
    ],
  },
  agents: {
    eyebrow: '支持的 Agent',
    title: '七种 Agent，从它们保存会话的位置读取。',
    lead: '各 Agent 的 home 目录覆盖设置同样生效。目录不存在时显示 0 个会话和检查过的路径；无法解析的文件会列出文件、行号和原因。',
    grok: 'Grok 只按轮次记录 Token 用量，因此 Grok 会话每轮对应一个请求。',
  },
  privacy: {
    eyebrow: '隐私',
    title: '会话留在你的机器上。',
    items: [
      { title: '只在本机', body: '所有处理都在本机完成。服务器只绑定 localhost，不会把任何内容发送到别处。' },
      { title: '只读', body: '会话文件只读，不写入。URL 只携带不透明的 trace id，从不包含路径。' },
      {
        title: '脱敏',
        body: '本地服务器把 home 目录替换成 ~，并把一组固定格式的 token 替换成占位符。其他形态的密钥不会被替换。',
      },
      { title: '报告始终脱敏', body: '报告仍保留会话文本和文件内容，分享前请先阅读。' },
      {
        title: '可随时删除的索引',
        body: '索引保存标题、路径、数字和用于搜索的提示词，内容未脱敏，文件权限为 0600。可以随时删除，或用 --no-index 运行。',
      },
    ],
  },
  docs: {
    eyebrow: '文档与源码',
    title: '继续阅读。',
    links: [
      { id: 'readme', label: 'README', body: '它是什么、一条命令，以及支持的 Agent。' },
      { id: 'guide', label: '用户指南', body: '概念、工作区、导出、MCP、隐私和排障。' },
      { id: 'reference', label: '参考文档', body: '公共接口、MCP 工具与导出格式。' },
      { id: 'architecture', label: '架构', body: '当前行为和系统结构。' },
      { id: 'design', label: '视觉设计', body: '页面、设计令牌和编码规则。' },
      { id: 'contributing', label: '贡献指南', body: '工作流、变更门禁和发布意图。' },
    ],
  },
  docsSidebar: {
    guide: '用户指南',
    reference: '参考文档',
    design: '视觉设计',
    fallbackNotice: '此页尚无中文译本，以下为英文原文。',
  },
  footer: {
    wake: 'Estela 是西班牙语，指船驶过水面后留下的航迹。会话日志是 Agent 运行后留下的痕迹，Estela 读的就是它。',
    license: 'GPL-3.0-only',
    changelog: '更新日志',
    security: '安全',
  },
} satisfies Dictionary
