# Agent Guidelines

This repository is a local-first viewer for coding-agent session logs. Treat every change as if it may be reviewed and installed by someone other than the author.

## Working Rules

- Keep changes scoped to the user request and nearby code.
- Prefer existing project patterns over new abstractions.
- Do not commit local config, credentials, generated logs, temporary workspaces, build artifacts, or machine-specific paths.
- Do not add private tokens, internal hostnames, private repository names, or personal filesystem paths.
- Use `rg` for searches when available.
- Update tests and documentation when behavior changes.

## Product Rules

- Canonical storage is ordered `events[]` plus `original`. Turn, step, and tree are projections.
- Missing data is `unavailable`. Never invent.
- Compaction is `kind: 'compaction'` plus `shadowedBy` on hidden events.
- `reconstruct(trace, eventId)` is the product. A ledger without it is a transcript browser.
- `getTrace` is one snapshot blob. No paging RPC. Do not use DevFrame streaming as session follow.
- Adapters fail loud on unknown generations. Do not silently drop events.
- UI is Solid + Tailwind v4 + shadcn-solid (`@kobalte/core`). Not React shadcn.
- Rush + pnpm. Do not add a root `pnpm-workspace.yaml`.
- Technical plans use `docs/plans/0000-template.md`. Writing rules stay in the global `technical-design-docs` skill. Do not copy that skill into this repo.

## Layers

| Package | Owns | Must not |
|---|---|---|
| `@agent-trace/schema` | `Trace`, event kinds, `shadowedBy` | DevFrame, UI |
| `@agent-trace/kernel` | load, fold, reconstruct, redact | DevFrame, UI |
| `@agent-trace/adapter-dsh` | dsh disk formats | UI, inventing turn boundaries |
| `@agent-trace/adapter-claude-code` | Claude Code JSONL | flattening sidechains into fake turns |
| `@agent-trace/adapter-codex` | Codex `rollout-*.jsonl` | treating `token_count` as conversation |
| `@agent-trace/adapter-opencode` | OpenCode `opencode.db#sessionId` | inventing turns |
| `@agent-trace/adapter-grok` | Grok session directory | flattening subagents |
| `@agent-trace/devframe` | RPC, CLI, SPA | parsing a host log |

## Project-Specific Commands

```bash
./scripts/install-git-hooks.sh
./scripts/check-repository.sh
./scripts/check-pr-title.sh "docs: update project template"
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js lint
node common/scripts/install-run-rush.js test
node common/scripts/install-run-rush.js typecheck
node common/scripts/install-run-rush.js build
```

There is no separate formatter and no package publish step. Do not claim implementation work is complete until the relevant commands pass, or until skipped commands are explained with concrete blockers.

## Development Workflow

For non-trivial changes:

1. Understand the requested behavior, affected domain concepts, ownership boundaries, and data flow.
2. Follow the Spec/Plan selection rules in `CONTRIBUTING.md`. Review required design artifacts before implementation. Record technical decisions in the Plan and migrate lasting constraints to current-state documentation.
3. Keep the implementation scoped to the task and nearby code.
4. Update tests and documentation when behavior, public contracts, or workflow expectations change.
5. Ensure local Git hooks are installed for the checkout when practical.
6. Run the commands above.
7. Open or update the PR with motivation, implementation notes, exact validation, skipped gates, evidence, and risks.

## Documentation

- Keep `README.md` focused on orientation, quick start, and current user-facing behavior.
- Use `CONTRIBUTING.md` for contribution workflow.
- Use `specs/` for active product behavior and `docs/plans/` for active technical designs. Current-state documentation owns implemented behavior.
- Use `docs/` for durable current-state knowledge.
- Update `CHANGELOG.md` for user-facing changes unless the change is docs-only or repository-only.

## Git

- Branch names should be short and descriptive.
- Commit messages should be concise and use conventional prefixes when they fit.
- Do not rewrite or discard user changes unless explicitly requested.
