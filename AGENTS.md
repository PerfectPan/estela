# agent-trace

Generic inspect DevTool for coding-agent session logs. Not a harness. Not dsh Trajectory.

## Layers

| Package | Owns | Must not |
|---|---|---|
| `@agent-trace/schema` | `Trace` / event kinds / `shadowedBy` | DevFrame, UI |
| `@agent-trace/kernel` | load, fold, reconstruct, redact | DevFrame, React |
| `@agent-trace/adapter-dsh` | dsh disk formats | UI, inventing turn boundaries |
| `@agent-trace/adapter-claude-code` | Claude Code JSONL | flattening sidechains into fake turns |
| `@agent-trace/adapter-codex` | Codex `rollout-*.jsonl` | treating token_count as conversation |
| `@agent-trace/adapter-opencode` | OpenCode `opencode.db#sessionId` | inventing turns |
| `@agent-trace/adapter-grok` | Grok session dir (`updates.jsonl`) | flattening subagents |
| `@agent-trace/devframe` | RPC, CLI, SPA, MCP | parsing a host log |

## Rules

- Canonical storage is ordered `events[]` plus `original`. Turn/step/tree are projections.
- Missing data is `unavailable`. Never invent.
- Compaction is `kind: 'compaction'` plus `shadowedBy` on hidden events.
- `reconstruct(trace, eventId)` is the product. Ledger without it is a transcript browser.
- `getTrace` is one snapshot blob. No paging RPC in v1. No DevFrame streaming as session follow.
- Adapters fail loud on unknown generations. Do not silently drop events.

## Tooling

- Rush + pnpm. Do not use a root `pnpm-workspace.yaml`.
- UI: Solid + Tailwind v4 + shadcn-solid (`@kobalte/core`). Not React shadcn.
- Lint: oxlint (`rush lint`).

## Commands

```sh
rush update
rush test
rush typecheck
rush lint
cd packages/devframe && rushx dev -- --no-auth
```
