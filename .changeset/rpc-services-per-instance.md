---
"@rivus/estela": none
---

Internal refactor: build RPC function definitions, the session publisher, the report source, and the report build queue per server instance instead of module-level singletons, and expose `writeReport` on `EstelaServer`. No command, option, output, or exit code of the CLI changes.
