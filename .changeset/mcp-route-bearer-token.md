---
"@rivus/estela": minor
---

`estela --mcp` now requires a bearer token on the HTTP MCP route: clients send `Authorization: Bearer <token>` with the token printed at startup, or set `ESTELA_MCP_TOKEN` to choose one that survives restarts. `--mcp` is refused with a `--host` that is not a loopback address.
