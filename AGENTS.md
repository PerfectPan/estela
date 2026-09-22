# Agent Guidelines

This repository is intended to become a maintainable, publishable project. Treat every change as if it may be reviewed, packaged, indexed, and installed by users.

## Working Rules

- Keep changes scoped to the user request and nearby code.
- Prefer existing project patterns over new abstractions.
- Do not commit local config, credentials, generated logs, temporary workspaces, build artifacts, or machine-specific paths.
- Do not add private tokens, internal hostnames, private repository names, or personal filesystem paths.
- Use `rg` for searches when available.
- Update tests and documentation when behavior changes.

## Project-Specific Commands

```bash
# Install local Git hooks:
./scripts/install-git-hooks.sh

# Repository checks:
./scripts/check-repository.sh

# PR/MR title check:
./scripts/check-pr-title.sh "docs: update project template"

# GitHub repository setup dry run:
./scripts/configure-github-repository.sh --repo PerfectPan/agent-trace

# Format:
# No formatter is configured.

# Lint:
node common/scripts/install-run-rush.js lint

# Test:
node common/scripts/install-run-rush.js test

# Typecheck:
node common/scripts/install-run-rush.js typecheck

# Build:
node common/scripts/install-run-rush.js build

# Package or release dry-run:
# Packages are not published.

# Security or package-specific hygiene scan:
rg --hidden --no-ignore -n "private-token|secret|internal-domain.example|HOME_PATH_PLACEHOLDER" . \
  --glob '!.git/**' \
  --glob '!.omx/**' \
  --glob '!AGENTS.md' \
  --glob '!CONTRIBUTING.md' \
  --glob '!SECURITY.md'
```

Do not claim implementation work is complete until the relevant commands pass, or until skipped commands are explained with concrete blockers.

## Development Workflow

For non-trivial changes:

1. Understand the requested behavior, affected domain concepts, ownership boundaries, and data flow.
2. Follow the Spec/Plan selection rules in `CONTRIBUTING.md`. Review required design artifacts before implementation. Record technical decisions in the Plan and migrate lasting constraints to current-state documentation.
3. Keep the implementation scoped to the task and nearby code.
4. Update tests and documentation when behavior, public contracts, or workflow expectations change.
5. Ensure local Git hooks are installed for the checkout when practical.
6. Run repository checks, title checks, and project-specific validation gates.
7. For a newly created GitHub repository, configure branch protection with `scripts/configure-github-repository.sh --repo PerfectPan/agent-trace --apply` only when the repository plan allows it.
8. Open or update the PR/MR with motivation, implementation notes, exact validation, skipped gates, evidence, and risks.

## Repository Architecture

- Organize code by domain boundaries, layer boundaries, and test boundaries before mechanical one-file-per-export preferences.
- `@agent-trace/schema` and `@agent-trace/kernel` hold the trace rules. They must not import DevFrame or UI.
- `packages/adapter-*` isolates host session formats. `@agent-trace/devframe` is the CLI and SPA entrypoint.
- The stored record is ordered `events[]` plus `original`. Turns and trees are projections. Missing fields stay unavailable.
- Compaction is `kind: 'compaction'` plus `shadowedBy`. `reconstruct(trace, eventId)` is the read model for what remained visible.
- `getTrace` returns one snapshot. Do not add a paged RPC for the static report.
- UI is Solid, Tailwind v4, and shadcn-solid. The monorepo is Rush. Do not add a root `pnpm-workspace.yaml`.
- Do not introduce a shared abstraction unless it removes real duplication, clarifies a boundary, or matches an existing project pattern.
- When a file starts mixing multiple responsibilities or layers, split by responsibility rather than by arbitrary size.
- Substantial product behavior uses one Spec plus one detailed Plan. Technical refactors use a Plan. Record technical choices there before implementation.
- Plans use `docs/plans/0000-template.md`. Writing rules stay in the installed `technical-design-docs` skill. Do not copy that skill into this repository.

## Documentation

- Keep `README.md` focused on orientation, quick start, and current user-facing behavior.
- Use `CONTRIBUTING.md` for contribution workflow.
- Use `specs/` for active product behavior and `docs/plans/` for active technical designs. Current-state documentation owns implemented behavior.
- Use `docs/` for durable current-state knowledge such as architecture, development guides, operational runbooks, references, and onboarding tutorials.
- Update `CHANGELOG.md` for user-facing changes unless the change is docs-only or repository-only.
- When behavior, configuration, commands, APIs, deployment, architecture, or operations change, update the relevant docs in the same PR/MR or explain why no docs changed.

## AI Delivery Workflow

When an AI agent completes implementation work:

1. Inspect `git status --short --branch`.
2. Verify generated files, secrets, machine paths, and build artifacts are not staged.
3. Run the required verification gates and record the exact commands.
4. Commit pending changes with a concise conventional commit message.
5. Push the branch and verify the remote head.
6. Create or reuse a GitHub Pull Request when the task is not landing directly on `main`.
7. Include a delivery summary with motivation, implementation notes, validation, and follow-up risks.

## Review Evidence

- PR/MR titles must follow `type(scope): summary`; use `scripts/check-pr-title.sh` to verify them.
- PR/MR descriptions must include motivation, implementation notes, exact validation commands, skipped gates with reasons, and follow-up risks.
- If a claim depends on logs, screenshots, package output, deployed behavior, or generated artifacts, attach or link the evidence in the PR/MR.
- Update the PR/MR description after substantial code changes, review-driven revisions, rebases that change behavior, or validation reruns.
- Keep GitHub PR and GitLab MR templates in sync if the project uses both hosting styles.

## Git

- Branch names should be short and descriptive, such as `docs/external-release-plan`.
- Commit messages should be concise and use conventional prefixes when they fit.
- Signed commits are preferred when local git signing is configured.
- Do not rewrite or discard user changes unless explicitly requested.

## Publish Safety Check

Before pushing public-facing or package-facing changes, scan for accidental private references. Adjust globs for the project stack:

```bash
rg --hidden --no-ignore -n "private-token|secret|internal-domain.example|HOME_PATH_PLACEHOLDER" . \
  --glob '!.git/**' \
  --glob '!.omx/**' \
  --glob '!AGENTS.md' \
  --glob '!CONTRIBUTING.md' \
  --glob '!SECURITY.md'
```
