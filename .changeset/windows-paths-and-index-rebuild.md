---
'@rivus/estela': patch
---

Windows fixes found by running the test suites on Windows:

- Session paths reach the session reader with `/` separators, so a Claude Code session opened by path shows its subagents, a Codex rollout and a Grok session given by path are recognized, and a session opened by path gets the same trace id as when it is picked from the session list.
- When several `estela` processes open a broken session index at the same time, the one rebuilding it waits for the others to close the file instead of running without the index.
