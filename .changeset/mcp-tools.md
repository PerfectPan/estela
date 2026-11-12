---
"@rivus/estela": minor
---

`estela mcp` gives coding agents seven read-only tools to inspect earlier sessions: list and search sessions, a session summary, turns, model requests, one event, and the reconstruction at an event, each with a named input schema and a bounded, always redacted result. Without a path it serves every session on the machine instead of the demo trace. The dev server serves these tools over HTTP only with `--mcp`, because that route is not gated by the one-time code.
