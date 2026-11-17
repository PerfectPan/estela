---
'@rivus/estela': patch
---

Windows fixes found by running the test suites on Windows:

- Session paths reach the session reader with `/` separators, so a Claude Code session opened by path shows its subagents, and a Codex rollout or a Grok session given by path is recognized. A session opened by path gets the same trace id as when it is picked from the session list, as long as the path is spelled with the same letter case. Trace ids of Windows sessions change once with this release: a saved `#/s/<id>` link from an earlier version no longer opens its session, and the session index computes those summaries again.
- `export-atif` and `export-otlp` without `--out` skip a default file name taken by a dangling symbolic link instead of writing to the link's target.
- When several `estela` processes open a broken session index at the same time, the one rebuilding it waits for the others to close the file instead of running without the index.
