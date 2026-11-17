---
'@rivus/estela': patch
---

Windows fixes found by running the test suites on Windows:

- A session path given on the command line or in `ESTELA_PATH` is passed to the session reader with `/` separators, so a Claude Code session opened by path shows its subagents, a Codex rollout and a Grok session are recognized, and the session gets the same trace id as when it is picked from the session list.
- When several `estela` processes open a broken session index at the same time, the one rebuilding it waits for the others to close the file instead of running without the index.
