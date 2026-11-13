---
"@rivus/estela": none
---

Internal: the server's services (session reading, session catalog, TraceStore, report writer) are built by one factory whose DevFrame definition binds them in `setup`; the CLI's `dev`, `build`, and `mcp` start from it, with no change in behavior.
