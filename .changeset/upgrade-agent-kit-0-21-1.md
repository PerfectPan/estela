---
"@rivus/agent-trace": patch
---

Upgrade @rivus/agent-kit to 0.21.1: Claude Code sessions whose records open with host-added text (system reminders, IDE context) now count turns and take prompts and titles from the user's text, and the trace view keeps that context in its own turn, so the session index recomputes once after upgrading. Homes hidden after a JSON escape, URL encoding or an ANSI colour are now redacted.
