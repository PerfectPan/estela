/**
 * Display names of the registered agents. They are product names and stay in English in every
 * locale (glossary in dictionary.zh-CN.ts). An unknown agent shows its id.
 */
const AGENT_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  grok: 'Grok',
}

export function agentName(id: string): string {
  return AGENT_NAMES[id] ?? id
}
