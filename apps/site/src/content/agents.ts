/** The README's "Supported agents" table. Names and paths are not translated. */
export const AGENTS = [
  { id: 'claude-code', name: 'Claude Code', paths: ['~/.claude/projects/'], home: 'CLAUDE_CONFIG_DIR' },
  {
    id: 'codex',
    name: 'Codex',
    paths: ['~/.codex/sessions/**/rollout-*.jsonl', '~/.codex/archived_sessions/**/rollout-*.jsonl'],
    home: 'CODEX_HOME',
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    paths: ['~/.dsh/sessions/<cwd>/<session-id>/session.v4.jsonl.zstd'],
    home: 'DSH_HOME',
  },
  { id: 'gemini-cli', name: 'Gemini CLI', paths: ['~/.gemini/tmp/**/chats/*.jsonl'], home: 'GEMINI_CLI_HOME' },
  { id: 'grok', name: 'Grok', paths: ['~/.grok/sessions/<cwd>/<session-id>/'], home: 'GROK_HOME' },
  { id: 'opencode', name: 'OpenCode', paths: ['~/.local/share/opencode/opencode.db'], home: 'XDG_DATA_HOME' },
  { id: 'pi', name: 'Pi', paths: ['~/.pi/agent/sessions/<cwd>/<time>_<id>.jsonl'], home: 'PI_CODING_AGENT_DIR' },
] as const
