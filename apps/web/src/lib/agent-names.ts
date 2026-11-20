/**
 * Display names of the registered agents. They are product names and stay in English in every
 * locale (glossary in dictionary.zh-CN.ts). An unknown agent shows its id.
 */
const AGENT_NAMES: Record<string, string> = {
  agy: 'Antigravity CLI',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  dim: 'DimCode',
  dsh: 'DeepSeek Harness',
  grok: 'Grok',
  'gemini-cli': 'Gemini CLI',
  kimi: 'Kimi Code',
  opencode: 'OpenCode',
  pi: 'Pi',
  qoder: 'Qoder CLI',
  zcode: 'ZCode',
}

export function agentName(id: string): string {
  return AGENT_NAMES[id] ?? id
}
