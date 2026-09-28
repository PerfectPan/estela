# Architecture

Audience: someone changing the viewer or adding a host adapter.

## Shape

```text
host log
  -> HostAdapter (TraceIO)
  -> Trace { schema: agent-trace, events[] }
  -> kernel fold / reconstruct / redact
  -> DevFrame getTrace
  -> Solid ledger + inspector
```

`events[]` is the archive. Turn sections and paired tool rows are projections in the client. `original` stays on every event for the Raw tab. `fold` adds session summary numbers only for capabilities the host declares.

`reconstruct(trace, eventId)` returns the ids still visible after compaction events in that prefix, plus slots that could not be recovered (`system`, `tools`). It does not invent messages.

## Packages

| Package | Role |
|---|---|
| `packages/schema` (`@rivus/agent-trace-schema`) | Canonical `Trace` (`schema: 'agent-trace'`), kinds, capabilities, `shadowedBy` |
| `packages/kernel` (`@rivus/agent-trace-kernel`) | `HostAdapter`, `TraceIO`, load, fold, reconstruct, redact, conformance |
| `packages/runtime-node` (`@rivus/agent-trace-runtime-node`) | `NodeIO` and `homeDir` |
| `packages/rpc` (`@rivus/agent-trace-rpc`) | `get-trace` and `reconstruct` over an injected session service |
| `packages/host-claude-code` | Claude Code JSONL, registered |
| `packages/host-codex` | Codex `rollout-*.jsonl`, registered |
| `packages/host-grok` | Grok `updates.jsonl` plus side files, registered |
| `packages/host-opencode` | OpenCode SQLite, kept, not registered |
| `packages/host-dsh` | detect stub, kept, not registered |
| `apps/web` (`@rivus/agent-trace-web`) | Solid SPA |
| `apps/cli` (`@rivus/agent-trace`) | DevFrame CLI, the only published package |

## Trust

Session files stay on disk. The dev server binds localhost. Static export should run through `redact` before sharing. Do not put machine paths or live secrets into fixtures.

## Out of the current viewer

Timeline overview, list virtualization, request dots, turn collapse, and a composer overlay are not implemented. dsh ingestion is not implemented.
