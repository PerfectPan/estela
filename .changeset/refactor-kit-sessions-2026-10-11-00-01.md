---
"@rivus/agent-trace": patch
---

Sessions are now read end to end through agent-kit. Claude Code sessions whose records carry no request id now show request and token counts; sessions under CLAUDE_CONFIG_DIR, CODEX_HOME, or GROK_HOME are found (an override replaces the default home), archived Codex sessions are listed; a malformed log line no longer fails a session — the session loads and the line is skipped; a session directory that cannot be read now shows as an error row instead of being left out silently; and Grok tool calls show the full arguments in the inspector, with the update's input keys merged in.
