---
"@rivus/agent-trace": none
---

Internal: event payloads are typed per kind on @rivus/agent-kit 0.14.0. A canonical trace file whose payload does not match its kind, such as a hook without type from older generated traces, is no longer read as a canonical trace and fails with No adapter accepted.
