---
"@rivus/estela": patch
---

Start the dev server and `mcp` when one agent's session folder cannot be read (for example a `~/.claude` without search permission): the other agents' sessions are listed, and the terminal names that folder with `~` and the reason instead of exiting with `Could not index sessions` and suggesting `--no-index`.
