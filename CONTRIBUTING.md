# Contributing

## Development Setup

Use Node.js 24.x: `rush.json` requires `>=24.0.0 <25`. The CLI itself runs on Node.js 24 or later, and `apps/cli/bin.mjs` exits before it loads the CLI when Node is older. Rush installs its own pnpm. Do not run a root `pnpm install`.

```bash
gh extension install PerfectPan/gh-repo-checks
./scripts/install-git-hooks.sh
gh repo-checks repository
node scripts/check-doc-translations.mjs
node scripts/release-intent.mjs check --base "$(git merge-base origin/main HEAD)"
node scripts/check-conventions.mjs
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
gh repo-checks pr-title "docs: add external release plan"
gh repo-checks pr-body pr-body.md
node common/scripts/install-run-rush.js install
node scripts/format.mjs --check
node scripts/lint-scripts.mjs
node common/scripts/install-run-rush.js lint
node common/scripts/install-run-rush.js test
node common/scripts/install-run-rush.js typecheck
node common/scripts/install-run-rush.js build
cd apps/cli && node ../../common/scripts/install-run-rushx.js dev -- --no-auth
```

The toolchain is Vite+ (`vp`): every Rush project lints with `vp lint` and tests with `vp test`, `apps/cli` builds with `vp pack` and `apps/web` with `vp build`, each from the project's one `vite.config.ts`. `tsc` stays the type check. The lint and format settings are the `lint` and `fmt` blocks of the root `vite.config.ts`; `vp lint` and `vp fmt` use the nearest config with such a block, and project configs have none.

`node scripts/format.mjs` formats the JS and TS files under `apps/`, `packages/`, and `scripts/`, and the root `vite.config.ts`, with `vp fmt`; `--check` writes nothing and fails on an unformatted file. It needs the Rush install, because it runs the vite-plus that `apps/cli` owns. Markdown, JSON, fixtures, and `common/` are not formatted. oxlint's `curly: all` requires a braced block for every `if`, `else`, `for`, `while`, and `do` body. `node scripts/lint-scripts.mjs` lints the root `scripts/` and `vite.config.ts`, which no Rush project covers, with the same settings. The CI `test` job and the pre-commit hook run the format check and the scripts lint.

There is no package publish command.

## Contribution Flow

1. Open an issue or discussion for ambiguous work.
2. Choose Spec and Plan artifacts using the [Change Design Gate](#change-design-gate) before substantial work. Review the behavior and technical design before implementing that scope.
3. Create a focused branch with a short descriptive name.
4. Install local Git hooks with `./scripts/install-git-hooks.sh` if this checkout has not already done so.
5. Identify the affected domain concepts, layer boundaries, data flow, and tests before changing code.
6. Implement the change, keeping responsibilities separated and using existing project patterns.
7. Add or update tests for behavior changes.
8. Update `README.md`, `docs/`, `AGENTS.md`, `CONTRIBUTING.md`, or the active Spec and Plan when user-facing behavior, architecture, development workflow, operations, or project policy changes.
9. Run repository checks, title and description checks, the format check, and the Rush lint, test, typecheck, and build gates.
10. Open a pull request with a conventional title, a summary of what changed and why, validation with skipped gates, and any risks.
11. Keep the PR description current after review feedback, rebases, validation reruns, or scope changes.

Small typo corrections, narrow documentation fixes, and repository metadata updates do not need a separate Spec and Plan.

## SDD Workflow And Document Lifecycle

1. Record the problem, affected users or maintainers, in-scope behavior, non-goals, and acceptance conditions.
2. Choose artifacts with the [Change Design Gate](#change-design-gate). Product work defaults to one behavioral Spec and one detailed Plan for the same deliverable. The Spec states required behavior: interactions and acceptance scenarios. The Plan owns the technical decisions (design, component and interface changes, data flow) and the detailed execution plan (ordered tasks, tests, exit conditions, validation, and rollback).
3. Review the behavior and technical design before implementing the affected scope. The Plan must resolve implementation decisions rather than leave them to the implementer; keep it blocked while a material decision is unresolved. New behavior revises the Spec. New implementation decisions revise the Plan.
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

A Spec defines observable interactions, scope, failure behavior, and acceptance examples. Use stable scenario IDs and Given/When/Then where useful. Link scenarios to tests. A Spec does not prescribe components, interfaces, or execution order. Keep active Specs under [`docs/specs/`](docs/specs/). A small change may keep both sections in the PR description. Split only when each slice has an independently demonstrable outcome.

A Plan records technical decisions and the detailed execution plan that implements them. Shared architecture, compatibility, security, and recovery decisions belong in a reviewed Plan. After implementation, move lasting constraints into current-state architecture or operations docs. This repository does not keep an RFC directory. Removing a proposal does not mark unimplemented ideas as delivered.

## Implementation Plans

[`docs/plans/`](docs/plans/) contains active Plans: technical decisions plus a detailed execution plan. Copy [`0000-template.md`](docs/plans/0000-template.md) and keep only the sections that apply. A product plan links its paired Spec. Explain the current constraints, the decisions, the boundaries, the failure and rollback behavior, and how the change will be verified. A file list alone is not a design.

The execution plan tells the implementer exactly what to do: preconditions, a completion contract, ordered tasks with files, changes, tests, and exit conditions, a validation ledger, and rollback per batch. Keep the plan blocked while a decision that changes scope, interfaces, data, or rollout is unresolved.

Keep unknown owners, dates, and interfaces marked "unconfirmed". A plan may make feature-specific technical decisions, but it cannot silently override current architecture. At completion, migrate lasting constraints into current-state docs and tests, then delete the completed Spec and plan in the final delivery PR. Keep unfinished scope visible.

## Bilingual Specs And Plans

Every active Spec and Plan has a Chinese reading copy beside it: `docs/specs/0001-foo.md` pairs with `docs/specs/0001-foo.zh-CN.md`, and `docs/plans/0001-foo.md` with `docs/plans/0001-foo.zh-CN.md`. The English file is the source of truth for review and implementation. The Chinese copy lets Chinese-speaking reviewers read the whole design.

- The English file changes first; the Chinese copy follows in the same PR.
- The Chinese copy starts with `> 中文阅读版。以英文原文 <English path> 为准。`
- It keeps the English structure: the same headings at every level, the same scenario and decision IDs, the same table rows, and every code block and diagram copied unchanged.
- It states the same content. It does not summarize, add, or settle an ambiguity the English leaves open.
- Chinese prose uses plain statements and noun-phrase headings. Identifiers, paths, commands, and field names stay as written in English.
- Templates and README files have no Chinese copy.

`node scripts/check-doc-translations.mjs` checks the pairing, the first line, heading counts per level, and code blocks. CI and the pre-commit hook run it. It cannot tell whether the prose says the same thing; reviewers check that.

## Release Intent

`@rivus/agent-trace` is the only published package, and it bundles every other workspace package. A PR that changes what it ships carries a Rush change file under `common/changes/@rivus/agent-trace/`. "What it ships" is any file under `apps/` or `packages/` except tests, fixtures, and Markdown, plus `common/config/rush/pnpm-lock.yaml`.

- Create the file with `node common/scripts/install-run-rush.js change`. Rush only notices edits inside the published project's folder; when it reports nothing to do for an edit elsewhere, use `node scripts/release-intent.mjs add --type <major|minor|patch|none> --message "<text>"`.
- The bump type follows semver for users of the CLI: `major` for a breaking change once 1.0 exists, `minor` for a new capability, `patch` for a fix. `none` records an internal change that should not trigger a release by itself; its message may be empty.
- The message is one or two sentences written for users of the CLI. It becomes a line in the generated `CHANGELOG.md`.
- CI runs `rush change --verify` and `node scripts/release-intent.mjs check` against the merge base. The checkout needs full history (`fetch-depth: 0`).
- `rush version --bump --version-policy agent-trace` consumes the change files, sets the version, and writes `apps/cli/CHANGELOG.md` and `CHANGELOG.json`. It runs only in the release workflow, which is not set up yet.
- Release notes come only from change files. Do not edit the generated changelogs or keep a hand-written root `CHANGELOG.md` beside them.

Documentation-only and workflow-only PRs need no change file.

Why a script: Rush requires change files only for projects in a version policy and does not follow dependencies, so an edit that only touches a bundled private package would reach users with no changelog entry. Changesets has the same gap ([changesets#944](https://github.com/changesets/changesets/issues/944), open since 2022). Putting the private packages into the version policy is not an option: `rush publish` publishes every project in a policy regardless of `"private"`. Remove `release-intent.mjs` if Rush gains this behavior.

## License

The project is licensed under GPL-3.0-only (`LICENSE`). Distributing the software or a modified version requires releasing its source under the same license. Package metadata uses the SPDX identifier `GPL-3.0-only`. Change the license only as a deliberate project decision, and keep third-party notices for code or data copied from other projects. Record those notices in [`third-party-notices.md`](third-party-notices.md).

## File Conventions

- File and directory names are kebab-case: lowercase letters and digits joined by `-`. Suffixes after the stem follow the same rule (`fold.test.ts`, `vite.config.ts`), except a locale tag such as `zh-CN`.
- Files under `fixtures/` keep the agent log's names when those names are not kebab-case (`system_prompt.txt`, `tool_definitions.json`).
- Names fixed by convention or a platform keep their form: `README.md`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `CHANGELOG.json`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`, `.gitlab/merge_request_templates/`, and everything under `common/`, which Rush owns.
- A code file (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.css`, and their variants) under `apps/`, `packages/`, or `scripts/` has at most 500 lines, tests included. Fixtures and documentation have no line limit. A file near the limit splits along a responsibility, not at an arbitrary line.

`node scripts/check-conventions.mjs` checks every tracked file. CI and the pre-commit hook run it.

The shared lint config adds three file rules: kebab-case names, at most 1000 lines, and one component per `.tsx` file (`react/no-multi-comp`, tests excluded). `check-conventions.mjs` stays, because its names and 500-line limit are stricter. A component used by one parent still gets its own file next to that parent. `apps/web/src/components/icons.tsx` is exempt in the root `vite.config.ts`: it is one family of stroke icons on a shared `Icon` base.

## Repository Architecture

- `packages/schema` and `packages/kernel` are domain rules. They must not import DevFrame or UI.
- Session reading is the external `@rivus/agent-kit`; `apps/cli` is the only package that imports it at runtime. Other packages may use its types with `import type`.
- `@rivus/agent-trace` (`apps/cli`) is the composition root and the only package that will be published. It bundles the other workspace packages. The Solid SPA is `@rivus/agent-trace-web` (`apps/web`).
- Fixtures live in `fixtures/` (`fixtures/sessions/<agent>/` for the session logs the conformance suites read).
- Shared lint, format, and `tsconfig` rules come from `@perfectpan/lint-config` (the `PerfectPan/lint-config` repository); see its README. The `lint` and `fmt` blocks of the root `vite.config.ts` spread its `vite-plus` export and `tsconfig.base.json` extends its tsconfig; both keep only this repository's rules. Change a shared default upstream, not here.
- `node scripts/check-layers.mjs` checks each Rush project's `@rivus/*` dependencies against the "May depend on" column in [`docs/plans/0001-external-release.md`](docs/plans/0001-external-release.md) section 2.2. CI and the pre-commit hook run it.

## Runtime checks

`schema`, `kernel`, and `rpc` must not import `node:*` outside tests. Two checks enforce the rule, and the CI test job runs both:

1. oxlint `no-restricted-imports` on `node:*` in the root `vite.config.ts` (test files are excluded).
2. `node scripts/check-browser-bundle.mjs` bundles kernel and rpc with vite-plus's tsdown for platform `browser` and fails when the bundle imports anything but `devframe`, such as an unresolved `node:*` import.

See [`docs/architecture/overview.md`](docs/architecture/overview.md).

## Pull Request Gates

CI runs when a Draft PR becomes Ready for review. Ordinary pushes, main merges and metadata edits do not start
it. Finish local checks before requesting CI. After changing the head or base, update the branch and select Draft
then Ready again; confirm that the current PR comparison passed before merging. The single `test` job includes
the repository checks, the PR title and description checks, and release intent; there is no separate Review
workflow. Editing the title or description does not re-run them; select Draft then Ready again after such an edit.
GitHub's PR checkout tests the merge result. A manual `workflow_dispatch` runs the selected branch as `manual checks`
for diagnosis, without the PR title, description, or release intent checks, and does not satisfy the required PR
`test` check. Do not retry account/billing-blocked
runs until the blocker is resolved.

CI runs all package typechecks and builds Web before the CLI smoke tests so the tests reuse that Web output.
The tarball smoke step then builds `@rivus/agent-trace` with `vp pack` (`rush build --to @rivus/agent-trace`, which also
runs the other packages' `tsc --noEmit` builds), packs it, and tests the installed tarball. If another package gains
a distinct build command, add it to CI. The CLI build smoke assertions share one subprocess. Dependency installation uses Rush install with
the committed lockfile; use Rush update locally only when dependency inputs change. pnpm rejects versions published
less than a day ago (`minimumReleaseAgeMinutes` in `common/config/rush/pnpm-config.json`), so pick versions at least a
day old when upgrading. A `vite-plus` upgrade also moves the vite-plus-core version in that file's `globalOverrides`
and `apps/web`'s `rolldown` devDependency to that core's `bundledVersions.rolldown`; the CLI build fails until they match.

`actions/cache@v6` caches the pnpm content-addressed store at `common/temp/pnpm-store` and npm download cache at
`~/.npm/_cacache`, keyed by runner OS and Rush/lockfile configuration. Every run still executes Rush install and the
checks. Installed workspace links, build outputs, credentials and CI results are not cached. Cache misses use the
same gate. Keep cache storage inside the included repository allowance.

## Pull Request Expectations

The PR template has three sections:

- **Summary**: what changed and why, with links to the issue, Spec, or Plan.
- **Validation**: the commands you ran and their results, evidence for behavior or packaging claims, and skipped gates with reasons.
- **Risks** (optional): compatibility, rollout, rollback, or follow-up risks. Delete it when there are none.

Use a conventional title:

```text
type(scope): summary
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Titles are English; `gh repo-checks pr-title` rejects CJK characters. Bot-generated PRs follow the same rule, so configure release and dependency bots to emit titles such as `chore(release): version packages` or `chore(deps): bump <package> to <version>`.

Summary and Validation must be present and contain real content, not template placeholders; other sections are optional. Do not include agent attribution lines such as "Generated with <tool>"; the author is accountable for the content. `gh repo-checks pr-body` enforces these rules, and the `test` job runs it as its `PR description` step. PRs opened by bot accounts skip that step, because dependency and release bots write their own bodies; they still must pass the title check.

Update the description when review feedback, rebases, or follow-up commits change the scope or validation result. Reviewers should be able to understand the final state from the PR without reconstructing it from comments.

## Repository Checks

The review checks come from [`PerfectPan/gh-repo-checks`](https://github.com/PerfectPan/gh-repo-checks): CI runs them through its GitHub Action (`uses: PerfectPan/gh-repo-checks@v1`), and locally they run as a GitHub CLI extension (`gh extension install PerfectPan/gh-repo-checks`). Do not copy the check scripts into this repository; change them upstream. Repository-specific additions, such as extra required files or forbidden patterns, go in `.github/repo-checks.conf`, and repository-specific scripts run as extra steps after the shared check. Here those are `check-doc-translations.mjs`, `check-conventions.mjs`, and `check-layers.mjs`, in the CI `test` job and in the pre-commit hook.

Run `gh repo-checks repository` locally before opening review. This generic check does not replace stack-specific tests, but it catches missing template files, tracked local artifacts, obvious secrets, private paths, and drift in review templates.

Workflows reference actions by their latest major version tag, such as `actions/checkout@v7`, not by commit SHA. Workflow files copied from `PerfectPan/project-template` take action upgrades from the template rather than local edits.

## Local Git Hooks

```bash
./scripts/install-git-hooks.sh
```

The pre-commit hook runs `git diff --cached --check`, `gh repo-checks repository --staged` (without the extension it warns and skips that check), `node scripts/check-doc-translations.mjs`, `node scripts/check-conventions.mjs`, `node scripts/check-layers.mjs`, `node scripts/format.mjs --check`, and `node scripts/lint-scripts.mjs`. Hooks are a local guardrail; CI and branch protection remain the authoritative enforcement because hooks can be missing or bypassed.

If `core.hooksPath` is already set to another path, `scripts/install-git-hooks.sh` fails instead of overwriting it. Re-run with `--force` only after confirming the existing hooks can be replaced or moved into `.githooks`.

## Repository Setup

After the GitHub repository exists, preview branch protection with:

```bash
gh repo-checks protect --repo PerfectPan/agent-trace --no-review-checks --check test
```

The command requires pull requests, one approving review (fresh after new pushes), linear history, resolved conversations, and the CI `test` check. This repository has no Review workflow; its review checks run inside `test`. `--no-review-checks` therefore drops the default `repository checks`, `conventional PR title`, and `PR description` contexts. A single maintainer cannot approve their own pull requests; pass `--approvals 0` to keep the other protections without a review requirement. If the repository already uses a ruleset, add these checks to the ruleset instead of layering classic branch protection on top.

Apply it only when the repository plan allows branch protection. Do not treat a failed apply on a private repository as a product defect.

## Security Reports

Use `SECURITY.md`. Do not include secrets or private filesystem paths in public issues or pull requests.
