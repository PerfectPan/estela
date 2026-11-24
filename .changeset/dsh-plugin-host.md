---
"@rivus/estela": none
---

Implement the host half of the private `@rivus/dsh-estela` DeepSeek Harness plugin (`src/host/{index,rpc,channel,sessions}.ts`) and add an opt-in `expect?: FileStamp` snapshot invariant (`SnapshotChangedError`) to `TraceStore`. No command, option, output, or exit code of the CLI changes.
