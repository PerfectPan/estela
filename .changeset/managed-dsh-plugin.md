---
"@rivus/agent-trace": minor
---

Read DeepSeek Harness through a managed dsh plugin. `agent-trace dsh-plugin install` writes a single-file Cordis plugin to `~/.dsh/plugins/agent-trace-dsh.mjs` and registers it in the home-level `~/.dsh/cordis.patch.yml` — idempotent, refusing a file it does not manage, coexisting with the plugins other tools install; `uninstall` removes both. While a dsh run executes, the plugin appends one JSON record per lifecycle event to `~/.dsh/agent-trace/<session id>.ndjson`, and the catalog picks the traces up as `dsh-plugin` sessions beside the log-scraping ones: each model message becomes one request with its usage, the lifecycle markers become system events, and record types a newer plugin writes still load as system events carrying their type. A write failure never breaks dsh.

Use dsh's actual agent/session/tools callbacks, route concurrent and resumed agents to the correct session, and drain pending writes at its durability checkpoint. Validate capture generations and usage without inventing missing counts, retain UTF-8 source ranges for raw reads, and register the adapter for every load/report path. Reject invalid CLI actions and ambiguous patch markers, quote plugin paths, preserve other registrations, replace files atomically, and return failure when registration fails.

Normalize dsh input usage to include cache reads and writes, and derive turn boundaries only from session turn events. Validate actual YAML sequences before registration; preserve empty-list comments and refuse nonempty flow lists or symbolic-link destinations before modifying them.
