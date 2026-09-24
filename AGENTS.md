# agent-trace

Generic inspect DevTool for coding-agent session logs. Not a harness. Not dsh Trajectory.

## Layers

| Directory | Package | Owns | May depend on |
|---|---|---|---|
| `apps/cli` | `@rivus/agent-trace` | Composition root: registers hosts, provides the Node runtime, starts the DevFrame server, terminal output, embeds the web build | every package; web's build output |
| `apps/web` | `@rivus/agent-trace-web` | Solid SPA | `rpc` (types), `kernel`, `schema` |
| `packages/rpc` | `@rivus/agent-trace-rpc` | RPC contracts and server handlers over an injected session service | `kernel`, `schema` |
| `packages/runtime-node` | `@rivus/agent-trace-runtime-node` | `NodeIO` (`TraceIO` over `node:fs`), home directory | `kernel`, `schema` |
| `packages/host-claude-code`, `host-codex`, `host-grok` | `@rivus/agent-trace-host-<id>` | One host each: layout knowledge, parsing, capabilities | `kernel`, `schema` |
| `packages/host-opencode`, `host-dsh` | `@rivus/agent-trace-host-<id>` | Kept, not registered in this release | `kernel`, `schema` |
| `packages/kernel` | `@rivus/agent-trace-kernel` | `TraceIO`, host protocol, `loadTrace`, `fold`, `reconstruct`, `redact`, conformance | `schema` |
| `packages/schema` | `@rivus/agent-trace-schema` | `Trace`, kinds, `shadowedBy` | nothing |

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
- A PR that changes shipped files under `apps/` or `packages/` carries a Rush change file; rules in `CONTRIBUTING.md#release-intent`.
- Contribution workflow, Specs, and Plans live in `CONTRIBUTING.md` and `docs/plans/`. Do not copy the `technical-design-docs` skill into this repo.
- File and directory names are kebab-case, and a code file has at most 500 lines; rules in `CONTRIBUTING.md#file-conventions`.
- Every Spec and Plan ships with a `.zh-CN.md` reading copy in the same PR; rules in `CONTRIBUTING.md#bilingual-specs-and-plans`.

## Commands

```sh
./scripts/check-repository.sh
node scripts/check-doc-translations.mjs
node scripts/check-conventions.mjs
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js lint
node common/scripts/install-run-rush.js test
node common/scripts/install-run-rush.js typecheck
node common/scripts/install-run-rush.js build
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
cd apps/cli && node ../../common/scripts/install-run-rushx.js dev -- --no-auth
```
