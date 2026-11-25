---
"@rivus/estela": patch
"@rivus/dsh-estela": patch
---

Keep what is looked up by out of redaction. With redaction on, an event or lane id that redaction would change (one that names the home directory, say) is shown as `@e<seq>` / `@l<n>` and every id input takes that form back, so `get-event`, "Export report", and `build` work for such ids. The MCP `cwd` filter matches the working directory as recorded, so two directories that redact to the same text are told apart. Redacting a value keeps every value of object keys that redact to the same text (the later ones get `#2`, `#3`).
