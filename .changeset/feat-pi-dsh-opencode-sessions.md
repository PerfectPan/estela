---
"@rivus/agent-trace": minor
---

Read Pi, DeepSeek Harness and OpenCode sessions. The session list, workspace, report and exports pick up the kit's new `pi`, `dsh` and `opencode` adapters without paging: Pi's JSONL sessions, DeepSeek Harness's Zstandard JSONL logs, and OpenCode's SQLite database. `get-event` reads originals through the kit's source-pointer resolver, so an event from a compressed file or a SQLite row returns its record instead of an unavailable one. The agent rail names and marks gain Pi, DeepSeek Harness and OpenCode (and Gemini CLI, which the upgraded kit also reads), and the support matrix documents their homes and overrides. The catalog upgrades `@rivus/agent-kit` to `0.24.0`, which the adapters require; the smoke test's whole-read counter and the catalog cache's mtime assertion follow the 0.24.0 platform's read and stat shapes.

Keep each OpenCode session's cached summary and search entries independent even when sessions share one database. Cache stamps include WAL changes, and original-record reads reject SQLite rows changed after the trace was loaded.

Keep Gemini CLI session homes out of synthetic test environments and improve its light-theme mark contrast. Exercise all adapter fixtures in structural and Harbor export validation, and reject unexpected export errors.

Patch the kit's Claude detector to recognize Gemini's distinct chat header, so direct CLI loads and exports use the correct reader while Claude logs under a chats directory still load as Claude. The patch stays in the reader dependency; custom provider registration and explicit agent selection keep their kit behavior.

When a compressed or database original has no platform resolver, report that missing reader directly instead of attempting a raw byte read.
