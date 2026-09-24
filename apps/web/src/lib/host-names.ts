/**
 * Display names of the registered hosts. They are product names and stay in English in every
 * locale (glossary in dictionary.zh-CN.ts). An unknown host shows its id.
 */
const HOST_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'grok': 'Grok',
}

export function hostName(id: string): string {
  return HOST_NAMES[id] ?? id
}
