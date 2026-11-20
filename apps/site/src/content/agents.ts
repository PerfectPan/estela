/** The README's "Supported agents" table. Names and paths are not translated. */
export const AGENTS = [
  {
    id: 'agy',
    name: 'Antigravity CLI',
    paths: ['~/.gemini/antigravity-cli/brain/<conversation-id>/.system_generated/logs/transcript_full.jsonl'],
    home: 'ANTIGRAVITY_GEMINI_DIR',
  },
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
  { id: 'dim', name: 'DimCode', paths: ['~/.dimcode/v2/dimcode.sqlite'], home: 'DIMCODE_HOME' },
  { id: 'gemini-cli', name: 'Gemini CLI', paths: ['~/.gemini/tmp/**/chats/*.jsonl'], home: 'GEMINI_CLI_HOME' },
  { id: 'grok', name: 'Grok', paths: ['~/.grok/sessions/<cwd>/<session-id>/'], home: 'GROK_HOME' },
  {
    id: 'kimi',
    name: 'Kimi Code',
    paths: ['~/.kimi-code/sessions/<work-dir>/<session-id>/agents/main/wire.jsonl'],
    home: 'KIMI_CODE_HOME',
  },
  { id: 'opencode', name: 'OpenCode', paths: ['~/.local/share/opencode/opencode.db'], home: 'XDG_DATA_HOME' },
  { id: 'pi', name: 'Pi', paths: ['~/.pi/agent/sessions/<cwd>/<time>_<id>.jsonl'], home: 'PI_CODING_AGENT_DIR' },
  { id: 'qoder', name: 'Qoder CLI', paths: ['~/.qoder/projects/<cwd>/<session-id>.jsonl'], home: 'QODER_CONFIG_DIR' },
  { id: 'zcode', name: 'ZCode', paths: ['~/.zcode/cli/db/db.sqlite'], home: 'ZCODE_STORAGE_DIR' },
] as const
