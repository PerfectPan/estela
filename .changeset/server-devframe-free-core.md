---
"@rivus/estela": none
---

Internal refactor: extract the DevFrame-free `createEstelaCore` entry (`@rivus/estela-server/core`) and the `@rivus/estela-rpc/trace-store` subpath so non-DevFrame hosts can construct a `TraceStore` without loading DevFrame or the session catalog. No command, option, output, or exit code of the CLI changes.
