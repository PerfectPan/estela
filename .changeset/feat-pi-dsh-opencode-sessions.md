---
"@rivus/agent-trace": minor
---

Read Pi, DeepSeek Harness and OpenCode sessions. The session list, workspace, report and exports pick up the kit's new `pi`, `dsh` and `opencode` adapters without paging: Pi's JSONL sessions, DeepSeek Harness's Zstandard JSONL logs, and OpenCode's SQLite database. `get-event` reads originals through the kit's source-pointer resolver, so an event from a compressed file or a SQLite row returns its record instead of an unavailable one. The agent rail names and marks gain Pi, DeepSeek Harness and OpenCode (and Gemini CLI, which the upgraded kit also reads), and the support matrix documents their homes and overrides. The catalog upgrades `@rivus/agent-kit` to `0.24.0`, which the adapters require; the smoke test's whole-read counter and the catalog cache's mtime assertion follow the 0.24.0 platform's read and stat shapes.
