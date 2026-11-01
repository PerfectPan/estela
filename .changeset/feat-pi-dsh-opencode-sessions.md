---
"@rivus/agent-trace": minor
---

Read Pi, DeepSeek Harness and OpenCode sessions. The session list, workspace, report and exports pick up the kit's new `pi`, `dsh` and `opencode` adapters without paging: Pi's JSONL sessions, DeepSeek Harness's Zstandard JSONL logs, and OpenCode's SQLite database. `get-event` reads originals through the kit's source-pointer resolver, so an event from a compressed file or a SQLite row returns its record instead of an unavailable one. The agent rail names and marks gain Pi, DeepSeek Harness and OpenCode, and the support matrix documents their homes and overrides.
