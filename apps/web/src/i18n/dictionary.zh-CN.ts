import type { Dictionary } from './dictionary.en.ts'

/**
 * Simplified Chinese UI strings (D13). Glossary (plan section 7), one term per concept:
 *
 * | English | 中文 | Note |
 * |---|---|---|
 * | session | 会话 | |
 * | host | 宿主 | Host names (Claude Code, Codex, Grok) stay in English. |
 * | project | 项目 | The last folder of the working directory. |
 * | turn | 回合 | One user prompt and what follows it. |
 * | request | 请求 | One model call. |
 * | token | Token | The k / M abbreviation is not translated. |
 * | duration | 时长 | |
 * | compaction | 压缩 | Context compaction. |
 * | subagent | 子代理 | |
 * | failed tool call | 失败的工具调用 | |
 * | could not read | 无法读取 | |
 * | context | 上下文 | |
 * | prompt | 提示 | The user's recorded text is never translated. |
 * | event | 事件 | |
 * | model saw | 模型所见 | |
 *
 * Section labels keep normal case and tracking in Chinese (`:lang(en)` only uppercases English).
 */
export const zhCN = {
  common: {
    appName: 'agent-trace',
    sessions: '会话',
    jumpTo: '跳转到事件、工具、文件…',
    themeToDark: '切换到深色主题',
    themeToLight: '切换到浅色主题',
    languageSwitch: '切换语言',
    languageShort: '中',
    dash: '—',
    openSession: '打开会话',
    couldNotRead: '无法读取',
    line: '第 {{ line }} 行',
    loading: '加载中…',
    notAvailable: '不可用',
    nothingLeaves: '只读取本机的会话日志，数据不会离开这台机器',
    kinds: {
      system: '系统',
      user: '用户',
      assistant: '助手',
      thinking: '思考',
      tool: '工具',
      compacted: '已压缩',
      request: '请求',
      hook: '钩子',
      unknown: '未知',
    },
  },
  browser: {
    title: '会话',
    onThisMachine: '本机共 {{ count }} 个',
    hosts: '宿主',
    allHosts: '全部宿主',
    checked: '已检查 {{ path }}',
    projects: '项目',
    showOnly: '只显示',
    hasCompaction: '有压缩',
    hasSubagents: '有子代理',
    hasFailedTools: '有失败的工具调用',
    search: '搜索标题和提示',
    sortLastActive: '最近活动',
    session: '会话',
    turns: '回合',
    requests: '请求',
    tokens: 'Token',
    duration: '时长',
    active: '活动',
    earlierThisWeek: '本周早些时候',
    noSessions: '没有找到会话。左侧列出了已检查的宿主目录。',
    noMatches: '没有匹配的会话。',
    summarizing: '正在读取 {{ count }} 个会话…',
    shape: '形状 · 上下文随时间变化',
    shapePending: '正在读取会话…',
    shapeMissing: '这个宿主没有记录每个请求的输入 Token。',
    firstPrompt: '第一条提示',
    durationLabel: '时长',
    requestsLabel: '请求',
    tokensInOut: '输入 / 输出 Token',
    compactionsSubagents: '压缩 · 子代理',
    failedTools: '{{ count }} 个失败的工具调用',
    connectionError: '无法连接 agent-trace 服务：{{ reason }}',
  },
  workspace: {
    search: '搜索',
    event: '事件',
    content: '内容',
    time: '时间',
    selectRecord: '选择一条记录',
    couldNotOpen: '无法打开这个会话',
    back: '返回会话列表',
  },
  inspector: {
    input: '输入',
    output: '输出',
    model: '模型所见',
    raw: '原始记录',
    close: '关闭检查器',
  },
  report: {
    title: '报告',
    export: '导出报告',
  },
} satisfies Dictionary
