---
"@rivus/estela": none
---

Implement the host half of the private `@rivus/dsh-estela` DeepSeek Harness plugin (`src/host/{index,rpc,channel,sessions}.ts`) and add an opt-in `expect?: FileStamp` snapshot invariant (`SnapshotChangedError`) to `TraceStore`. These changes are internal to the private plugin and opt-in `TraceStore` API; the user-visible Raw fix for rewritten compressed logs is recorded in `compressed-original-after-rewrite.md`.
