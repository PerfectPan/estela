---
"@rivus/agent-trace": minor
---

Read Pi, DeepSeek Harness and OpenCode sessions. The session list, workspace, reports, and exports find Pi's JSONL sessions, DeepSeek Harness's Zstandard logs, and OpenCode's SQLite database; a session in a shared database is opened as `opencode.db#<sessionId>`. `get-event` returns the original record of a compressed line or a database row, and a record changed since the session was loaded comes back as unavailable with the reason. A report decompresses a compressed log once for all of its events instead of once per event. The agent rail, picker, and marks use the product names Pi, DeepSeek Harness, OpenCode, and Gemini CLI, Claude sessions under a chats directory still load as Claude, and the README lists the new agents' homes and overrides.

Sessions that share one OpenCode database keep independent cached summaries and search entries: each cache entry follows that session's own last write, and reading an original rejects a row changed after the session was loaded. A large OpenCode database does not make its sessions' summaries run one at a time.

Keep the DSH and Pi marks readable at the list's small text size in both themes, and improve Gemini CLI's contrast on light backgrounds.
