# Contributing

## Development Setup

Use Node.js 22.18 or later. `rush.json` still allows `>=20.11.0 <25`, but the CLI imports `.ts` directly and `adapter-opencode` uses `node:sqlite`; both fail on 20.x and on 22 before 22.18. Rush installs its own pnpm. Do not run a root `pnpm install`.

```bash
./scripts/install-git-hooks.sh
./scripts/check-repository.sh
node scripts/check-doc-translations.mjs
node scripts/release-intent.mjs check --base "$(git merge-base origin/main HEAD)"
./scripts/check-pr-title.sh "docs: add external release plan"
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js lint
node common/scripts/install-run-rush.js test
node common/scripts/install-run-rush.js typecheck
node common/scripts/install-run-rush.js build
cd packages/devframe && node ../../common/scripts/install-run-rushx.js dev -- --no-auth
```

There is no formatter and no package publish command.

## Contribution Flow

1. Open an issue or discussion for ambiguous work.
2. Choose Spec and Plan artifacts using the [Change Design Gate](#change-design-gate) before substantial work. Review the behavior and technical design before implementing that scope.
3. Create a focused branch with a short descriptive name.
4. Install local Git hooks with `./scripts/install-git-hooks.sh` if this checkout has not already done so.
5. Identify the affected domain concepts, layer boundaries, data flow, and tests before changing code.
6. Implement the change, keeping responsibilities separated and using existing project patterns.
7. Add or update tests for behavior changes.
8. Update `README.md`, `CHANGELOG.md`, `docs/`, `AGENTS.md`, `CONTRIBUTING.md`, or the active Spec and Plan when user-facing behavior, architecture, development workflow, operations, or project policy changes.
9. Run repository checks, title checks, and the Rush lint, test, typecheck, and build gates.
10. Open a pull request with a conventional title, motivation, implementation notes, validation, evidence, skipped gates, and follow-up risks.

Small typo corrections, narrow documentation fixes, and repository metadata updates do not need a separate Spec and Plan.

## SDD Workflow And Document Lifecycle

1. Record the problem, affected users or maintainers, in-scope behavior, non-goals, and acceptance conditions.
2. Choose artifacts with the [Change Design Gate](#change-design-gate). Product work defaults to one behavioral Spec and one detailed Plan for the same deliverable. The Spec states interactions and acceptance scenarios. The Plan owns technical design, component and interface changes, data flow, implementation order, and verification.
3. Review the behavior and technical design before implementing the affected scope. The Plan must resolve implementation decisions rather than leave them to the implementer. New behavior revises the Spec. New implementation decisions revise the Plan.
4. Implement inside that boundary. Add evidence for each acceptance condition, or say why existing evidence is enough. Update current-state docs in the same change.
5. Before retiring a completed Spec or Plan, move still-valid behavior, invariants, and operational limits into current-state docs and tests. The final delivery PR may delete the completed files, together with their Chinese reading copies. Keep an unfinished Spec or Plan active.
6. Git history and the delivery PR keep the retired decision. Do not copy completed Specs or Plans into a second archive.

## Change Design Gate

Every change needs a requirement record. Use the smallest set of artifacts that makes behavior and implementation reviewable.

| Change type | Required artifact |
| --- | --- |
| Product behavior | One Spec plus one detailed Plan for the same deliverable |
| Technical refactor without changed user behavior | Detailed Plan with compatibility and acceptance conditions |
| Narrow maintenance, tests, or documentation | Requirement and PR checklist; a separate Plan only when useful |

A Spec defines observable interactions, scope, failure behavior, and acceptance examples. Use stable scenario IDs and Given/When/Then where useful. Link scenarios to tests. A Spec does not prescribe components, interfaces, or execution order. Keep active Specs under [`specs/`](specs/). Split only when each slice has an independently demonstrable outcome.

Shared architecture, compatibility, security, and recovery decisions belong in a reviewed Plan. After implementation, move lasting constraints into current-state architecture or operations docs. This repository does not keep an RFC directory.

## Implementation Plans

[`docs/plans/`](docs/plans/) contains active technical design documents. Copy [`0000-template.md`](docs/plans/0000-template.md) and keep only the sections that apply. A product plan links its paired Spec. Explain the current constraints, the decisions, the boundaries, the failure and rollback behavior, and how the change will be verified. A file list alone is not a design.

Keep unknown owners, dates, and interfaces marked "unconfirmed". A plan may make feature-specific technical decisions, but it cannot silently override current architecture. At completion, migrate lasting constraints into current-state docs and tests, then delete the completed Spec and plan in the final delivery PR. Keep unfinished scope visible.

## Bilingual Specs And Plans

Every active Spec and Plan has a Chinese reading copy beside it: `specs/0001-foo.md` pairs with `specs/0001-foo.zh-CN.md`, and `docs/plans/0001-foo.md` with `docs/plans/0001-foo.zh-CN.md`. The English file is the source of truth for review and implementation. The Chinese copy lets Chinese-speaking reviewers read the whole design.

- The English file changes first; the Chinese copy follows in the same PR.
- The Chinese copy starts with `> 中文阅读版。以英文原文 <English path> 为准。`
- It keeps the English structure: the same headings at every level, the same scenario and decision IDs, the same table rows, and every code block and diagram copied unchanged.
- It states the same content. It does not summarize, add, or settle an ambiguity the English leaves open.
- Chinese prose uses plain statements and noun-phrase headings. Identifiers, paths, commands, and field names stay as written in English.
- Templates and README files have no Chinese copy.

`node scripts/check-doc-translations.mjs` checks the pairing, the first line, heading counts per level, and code blocks. CI and the pre-commit hook run it. It cannot tell whether the prose says the same thing; reviewers check that.

## Release Intent

`@rivus/agent-trace` is the only published package, and it bundles every other workspace package. A PR that changes what it ships carries a Rush change file under `common/changes/@rivus/agent-trace/`. "What it ships" is any file under `packages/` except tests, fixtures, and Markdown, plus `common/config/rush/pnpm-lock.yaml`.

- Create the file with `node common/scripts/install-run-rush.js change`. Rush only notices edits inside `packages/devframe`; when it reports nothing to do for an edit elsewhere under `packages/`, use `node scripts/release-intent.mjs add --type <major|minor|patch|none> --message "<text>"`.
- The bump type follows semver for users of the CLI: `major` for a breaking change once 1.0 exists, `minor` for a new capability, `patch` for a fix. `none` records an internal change that should not trigger a release by itself; its message may be empty.
- The message is one or two sentences written for users of the CLI. It becomes a line in the generated `CHANGELOG.md`.
- CI runs `rush change --verify` and `node scripts/release-intent.mjs check` against the merge base. The checkout needs full history (`fetch-depth: 0`).
- `rush version --bump --version-policy agent-trace` consumes the change files, sets the version, and writes `packages/devframe/CHANGELOG.md` and `CHANGELOG.json`. It runs only in the release workflow, which is not set up yet.

Documentation-only and workflow-only PRs need no change file.

## Repository Architecture

- `@agent-trace/schema` and `@agent-trace/kernel` are domain rules. They must not import DevFrame or UI.
- Host packages under `packages/adapter-*` are infrastructure adapters.
- `@rivus/agent-trace` (`packages/devframe`) is the CLI and SPA entrypoint and the only package that will be published. It bundles the other workspace packages.
- Fixtures live in `fixtures/` and next to adapter tests.

See [`docs/architecture/overview.md`](docs/architecture/overview.md).

## Pull Request Expectations

Use a conventional title: `type(scope): summary`.

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

## Local Git Hooks

```bash
./scripts/install-git-hooks.sh
```

The pre-commit hook runs `git diff --cached --check` and `./scripts/check-repository.sh --staged`. If `core.hooksPath` is already set, the installer fails instead of overwriting it.

## Repository Setup

After the GitHub repository exists, preview branch protection with:

```bash
./scripts/configure-github-repository.sh --repo PerfectPan/agent-trace
```

Apply it only when the repository plan allows branch protection. Do not treat a failed apply on a private repository as a product defect.

## Security Reports

Use `SECURITY.md`. Do not include secrets or private filesystem paths in public issues or pull requests.
