---
"@rivus/estela": minor
---

Read Antigravity CLI, DimCode, Kimi Code, and Qoder CLI sessions, and list ZCode, which was already read, by its product name. Redaction now also replaces Stripe, GitLab, Hugging Face, and Google keys, JWTs, Slack webhook URLs, the values of credential assignments such as `PASSWORD=` and `client_secret:`, `Authorization` header values, and URL passwords. A session title or first prompt cut inside a home path no longer shows the start of the user name, in any spelling. Both come from `@rivus/agent-kit` 0.26.0. ZCode and DimCode sessions now see commits still in the database's write-ahead log, as OpenCode sessions did. An OpenCode or ZCode session keeps its cached summary across a start where nothing was written to it, and `estela_list_sessions` reports `sizeBytes` 0 for it, since the database file holds other sessions too.
