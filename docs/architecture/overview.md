# Architecture

Audience: someone changing the viewer or adding a host adapter.

## Shape

```text
host log
  -> adapter
  -> Trace { events[] }
  -> kernel fold / reconstruct / redact
  -> DevFrame getTrace
  -> Solid ledger + inspector
```

`events[]` is the archive. Turn sections and paired tool rows are projections in the client. `original` stays on every event for the Raw tab.

`reconstruct(trace, eventId)` returns the ids still visible after compaction events in that prefix, plus slots that could not be recovered (`system`, `tools`). It does not invent messages.

## Packages

| Package | Role |
|---|---|
| `packages/schema` | `Trace`, kinds, `shadowedBy` |
| `packages/kernel` | load, fold, reconstruct, redact |
| `packages/adapter-grok` | Grok `updates.jsonl` plus optional system prompt and tool definitions |
| `packages/adapter-codex` | Codex `rollout-*.jsonl` |
| `packages/adapter-opencode` | OpenCode SQLite, addressed as `opencode.db#sessionId` |
| `packages/adapter-claude-code` | detect stub |
| `packages/adapter-dsh` | detect stub |
| `packages/devframe` | DevFrame RPC, CLI, Solid SPA |

## Trust

Session files stay on disk. The dev server binds localhost. Static export should run through `redact` before sharing. Do not put machine paths or live secrets into fixtures.

## Out of the current viewer

Timeline overview, list virtualization, request dots, turn collapse, and a composer overlay are not implemented. Claude Code and dsh ingestion are not implemented.
