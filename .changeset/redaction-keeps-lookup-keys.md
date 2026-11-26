---
"@rivus/estela": patch
"@rivus/dsh-estela": patch
---

Keep what is looked up by out of redaction. With redaction on, an event or lane id that redaction would change (one that names the home directory, say) is shown as `@e<seq>` / `@l<n>` and every id input takes that form back, so `get-event`, "Export report", and `build` work for such ids. The MCP `cwd` filter matches the working directory as recorded, so two directories that redact to the same text are told apart. A report gives such ids their own aliases even with `ESTELA_REDACT=0`, so an exported report no longer fails to open them and two ids that redact alike do not get mixed up. Redacting a value keeps every value of object keys that redact to the same text (the later ones get `#2`, `#3`).
