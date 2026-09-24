# agent-trace

Generic inspect DevTool for coding-agent session logs. Not a harness. Not dsh Trajectory.

## Layers

| Package | Owns | Must not |
|---|---|---|
| `@agent-trace/schema` | `Trace` / event kinds / `shadowedBy` | DevFrame, UI |
| `@agent-trace/kernel` | load, fold, reconstruct, redact | DevFrame, UI |
| `@agent-trace/adapter-dsh` | dsh disk formats | UI, inventing turn boundaries |
| `@agent-trace/adapter-claude-code` | Claude Code JSONL | flattening sidechains into fake turns |
| `@agent-trace/adapter-codex` | Codex `rollout-*.jsonl` | treating `token_count` as conversation |
| `@agent-trace/adapter-opencode` | OpenCode `opencode.db#sessionId` | inventing turns |
| `@agent-trace/adapter-grok` | Grok session directory | flattening subagents |
| `@agent-trace/devframe` | RPC, CLI, SPA | parsing a host log |

## Rules

- Canonical storage is ordered `events[]` plus `original`. Turn, step, and tree are projections.
- Missing data is `unavailable`. Never invent.
- Compaction is `kind: 'compaction'` plus `shadowedBy` on hidden events.
- `reconstruct(trace, eventId)` is the product. A ledger without it is a transcript browser.
- `getTrace` is one snapshot blob. No paging RPC. Do not use DevFrame streaming as session follow.
- Adapters fail loud on unknown generations. Do not silently drop events.

## Tooling

- Rush + pnpm. Do not use a root `pnpm-workspace.yaml`.
- UI: Solid + Tailwind v4 + shadcn-solid (`@kobalte/core`). Not React shadcn.
- Lint is oxlint. No formatter is configured.
- Contribution workflow, Specs, and Plans live in `CONTRIBUTING.md` and `docs/plans/`. Do not copy the `technical-design-docs` skill into this repo.
- Every Spec and Plan ships with a `.zh-CN.md` reading copy in the same PR; rules in `CONTRIBUTING.md#bilingual-specs-and-plans`.

## Commands

```sh
./scripts/check-repository.sh
node scripts/check-doc-translations.mjs
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js lint
node common/scripts/install-run-rush.js test
node common/scripts/install-run-rush.js typecheck
node common/scripts/install-run-rush.js build
cd packages/devframe && node ../../common/scripts/install-run-rushx.js dev -- --no-auth
```
