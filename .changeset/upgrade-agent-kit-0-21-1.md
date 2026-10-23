---
"@rivus/agent-trace": patch
---

Upgrade @rivus/agent-kit to 0.21.1: Claude Code sessions whose records open with host-added text (system reminders, IDE context) now count turns and take prompts and titles from the user's text, so the session index recomputes once after upgrading. The trace view keeps such a record's host context in its own turn instead of the end of the previous one. Homes hidden after a JSON escape, URL encoding or an ANSI colour are now redacted.
