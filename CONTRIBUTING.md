# Contributing

## Development Setup

Use Node.js 24.x: the root `package.json` requires `>=24.0.0 <25`, and `devEngines.runtime` fails `pnpm install` on any other version. The CLI itself runs on Node.js 24 or later, and `apps/cli/bin.mjs` exits before it loads the CLI when Node is older. pnpm switches itself to the version pinned by `packageManager` in the root `package.json`.

```bash
gh extension install PerfectPan/gh-repo-checks
./scripts/install-git-hooks.sh
gh repo-checks repository
node scripts/check-doc-translations.mjs
node scripts/check-conventions.mjs
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
gh repo-checks pr-title "docs: add external release plan"
gh repo-checks pr-body pr-body.md
pnpm install
node scripts/format.mjs --check
node scripts/lint-scripts.mjs
pnpm lint
pnpm test
pnpm typecheck
pnpm build
cd apps/cli && pnpm run dev -- --no-auth
```

The toolchain is Vite+ (`vp`): every workspace package lints with `vp lint` and tests with `vp test`, `apps/cli` builds with `vp pack` and `apps/web` with `vp build`, each from the package's one `vite.config.ts`. `tsc` stays the type check. The lint and format settings are the `lint` and `fmt` blocks of the root `vite.config.ts`; `vp lint` and `vp fmt` use the nearest config with such a block, and package configs have none.

`node scripts/format.mjs` formats the JS and TS files under `apps/`, `packages/`, and `scripts/`, and the root `vite.config.ts`, with `vp fmt`; `--check` writes nothing and fails on an unformatted file. It needs `pnpm install` first, because it runs the vite-plus that `apps/cli` owns. Markdown, JSON, and fixtures are not formatted. oxlint's `curly: all` requires a braced block for every `if`, `else`, `for`, `while`, and `do` body. `node scripts/lint-scripts.mjs` lints the root `scripts/` and `vite.config.ts`, which no workspace package's lint covers, with the same settings. The CI `test` job and the pre-commit hook run the format check and the scripts lint.

## Contribution Flow

1. Open an issue or discussion for ambiguous work.
2. Choose Spec and Plan artifacts using the [Change Design Gate](#change-design-gate) before substantial work. Review the behavior and technical design before implementing that scope.
3. Create a focused branch with a short descriptive name.
4. Install local Git hooks with `./scripts/install-git-hooks.sh` if this checkout has not already done so.
5. Identify the affected domain concepts, layer boundaries, data flow, and tests before changing code.
6. Implement the change, keeping responsibilities separated and using existing project patterns.
7. Add or update tests for behavior changes.
8. Update `README.md`, `docs/`, `AGENTS.md`, `CONTRIBUTING.md`, or the active Spec and Plan when user-facing behavior, architecture, development workflow, operations, or project policy changes.
9. Run repository checks, title and description checks, the format check, and the pnpm lint, test, typecheck, and build gates.
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
- Templates and README files other than the root README have no Chinese copy; see [Bilingual README](#bilingual-readme).

`node scripts/check-doc-translations.mjs` checks the pairing, the first line, heading counts per level, and code blocks. CI and the pre-commit hook run it. It cannot tell whether the prose says the same thing; reviewers check that.

## Bilingual README

The root `README.md` has one Chinese reading copy, `README.zh-CN.md`. English is the source of truth for review and implementation.

- The English file changes first; the Chinese copy follows in the same PR.
- The Chinese copy starts with `> 中文阅读版。以英文原文 README.md 为准。`
- It keeps the English structure: the same headings at every level, and every code block copied unchanged.
- It states the same content. It does not summarize, add, or settle an ambiguity the English leaves open.
- Chinese prose uses plain statements and noun-phrase headings. Identifiers, paths, commands, and field names stay as written in English.

`node scripts/check-doc-translations.mjs` checks the README pair along with the Spec and Plan pairs.

## Release Intent

`@rivus/agent-trace` is the only published package, and it bundles every other workspace package. A PR that changes what it ships carries a changeset under `.changeset/` naming `@rivus/agent-trace`. "What it ships" is any file under `apps/` or `packages/` except tests, fixtures, and Markdown, plus `pnpm-lock.yaml`. An edit that only touches a bundled private package needs the changeset on the CLI package too: the version bump and the changelog line ride on the published package.

- Create the file with `pnpm change @rivus/agent-trace --bump <major|minor|patch|none> --summary "<text>"`, which also runs without a terminal and invents a random file name — rename it to a kebab-case slug — or copy an existing `.changeset/*.md` entry and edit it.
- The bump type follows semver for users of the CLI: `major` for a breaking change once 1.0 exists, `minor` for a new capability, `patch` for a fix. `none` records an internal change: it neither bumps the version nor writes a changelog line, and its message may be empty.
- The message is one or two sentences written for users of the CLI. It becomes a line in the generated `CHANGELOG.md`.
- CI does not verify that a changeset is present; the PR template carries the reminder.
- On a push to `main`, the [Publish workflow](#publishing-to-npm) uses `changesets/action@v2` and `pnpm version -r` to open or update the `chore(release): version packages` PR when changesets are pending. It consumes the changesets, writes `apps/cli/CHANGELOG.md`, appends the intents to `.changeset/ledger.yaml`, and applies the version bump. Each update leaves the PR in Draft; a maintainer marks it Ready for review to start CI, then merges after CI passes.
- Release notes come only from changesets. Do not edit the generated changelog or keep a hand-written root `CHANGELOG.md` beside it.

### Bot Pull Requests

- **Renovate npm PRs**: [`renovate.json`](renovate.json) enables only the npm manager; GitHub Actions stay with Dependabot.
  Renovate checks on Mondays from 00:00 to 06:59 in Asia/Shanghai, waits seven days after a release, and opens at
  most five concurrent version-update PRs. The waiting period stays above the workspace's one-day install policy in
  [`pnpm-workspace.yaml`](pnpm-workspace.yaml). `@rivus/*` packages are exempt from the wait, so a kit release
  reaches this repository in the next run. `rangeStrategy: "bump"` updates declared ranges and regenerates the pnpm
  lockfile through `pnpm install`.

  The catch-all groups separate minor/patch updates from majors. Later rules give the `packages:vitePlus` toolchain
  its own group and `@rivus/agent-kit` a group of its own, so a kit release is reviewed separately from routine
  updates; if a package adopts an Effect entry, add `effect` to that group.

  Node upgrades remain deliberate: `engines`, `devEngines.runtime` and major `@types/node` updates are disabled.
  `@perfectpan/lint-config` stays disabled because it is a Git dependency whose upgrades need accompanying code fixes.

  Lock-file maintenance runs on the first day of each month from 00:00 to 06:59 in Asia/Shanghai.

  Renovate opens a **Dependency Dashboard** issue through `config:recommended`; use its checkboxes to retry or
  recreate an update. npm security findings come from Renovate's OSV checks (`osvVulnerabilityAlerts`), and
  `vulnerabilityAlerts.rangeStrategy: "bump"` keeps security fixes on the tested `pnpm install` path. Security PRs
  can bypass release-age and schedule limits.

- **Dependabot actions PRs**: `.github/dependabot.yml` updates GitHub Actions weekly with the `chore(deps)` prefix.

- **Changesets**: bot PRs carry none. Because the lockfile counts as what the CLI ships, an npm update that passes
  CI still needs a patch changeset for `@rivus/agent-trace` added by the reviewer before merging (`pnpm change
  @rivus/agent-trace --bump patch --summary "..."`), per the Release Intent rules above. Lock-file-only updates
  follow the same rule when a bundled dependency changed the shipped output.

### Publishing to npm

`.github/workflows/publish.yml` runs on every push to `main`. Its version job prepares the draft version PR when changesets are pending; publishing waits until none remain. With no pending changesets, the publish job runs CLI smoke tests against a production-built, installed tarball, then uses pnpm's recursive publishing to upload only workspace versions absent from npm. A `main` push whose package versions are already on npm uploads nothing.

Manual dispatch is also restricted to `main`. It bypasses the version job and defaults to `dry-run`, which passes `--dry-run` to `pnpm publish`. It builds and tests the package and runs pnpm's Git checks without uploading or creating a Release; it needs no npm publishing credential. Uncheck it only for an intentional manual publish.

The workflow supports [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): `id-token: write` supplies the OIDC token, which pnpm exchanges for a short-lived credential. Configure the package's trusted publisher on npmjs.com with GitHub owner `PerfectPan`, repository `agent-trace`, workflow filename `publish.yml`, and no environment. Enable **Allow npm publish**: new trusted publishers permit staged publishing by default. Private GitHub repositories can use trusted publishing; provenance attestations additionally require a public repository and a public npm package.

A new package must exist before npm accepts a trusted publisher: publish an empty bootstrap prerelease from a temporary directory using local npm login and 2FA, configure its trusted publisher, then enable the automatic version flow. Workflow publishing uses only OIDC and no repository npm token secret.

A new trusted publisher expires unless it completes a successful publish within two days. If the release is delayed, recreate the expired configuration before publishing; a dry run does not validate it.

A real publish runs `pnpm publish -r --access public --registry https://registry.npmjs.org/ --publish-wait-timeout 600000 --report-summary`, with pnpm's Git checks enabled. Recursive publishing packs the same production build output again rather than uploading the smoke archive; pnpm rewrites `workspace:` and `catalog:` specifiers. The tag and Release step runs only when `pnpm-publish-summary.json` lists `@rivus/agent-trace` as published; an empty summary skips it. The workflow saves the summary as the `publish-summary` artifact.

For each published version, Release notes come from its generated `apps/cli/CHANGELOG.md` section. The workflow pushes `"$GITHUB_SHA:refs/tags/$tag"` without force, then creates the Release with `--verify-tag` and those notes. If tagging or Release creation fails, rerunning skips the existing npm version and does not repair its missing tag or Release; recover those manually.

If the workflow fails before uploading, rerun it. If an upload may have succeeded, including an availability timeout, query the exact version first:

```bash
version=0.1.0 # Use the failed run's version.
npm view "@rivus/agent-trace@$version" name version dist gitHead --json --registry https://registry.npmjs.org/
```

Authentication, network, and other query failures do not establish that a version is absent. An `E404` after an accepted upload or an availability timeout can mean the package is not visible yet: wait and query again without re-uploading. Rerun publishing only after confirming that the upload was not accepted. If the version exists, do not republish it or rerun the whole workflow. Complete only the missing tag and Release:

1. Use a clean checkout of the original run's `GITHUB_SHA`. Confirm the published package came from that run using its publish output and registry metadata; check `gitHead` against the commit when the field is present. Stop if the package's source cannot be confirmed.
2. Inspect the remote tag with `git ls-remote --tags origin "refs/tags/v$version" "refs/tags/v$version^{}"`. An existing tag must resolve to the original commit. If absent, set `release_sha` to the original run's SHA and run `git push origin "$release_sha:refs/tags/v$version"`. Stop on any conflict; do not move or force-push a tag.
3. If the GitHub Release is missing, save the body of that version's `apps/cli/CHANGELOG.md` section to a temporary notes file, then run `gh release create "v$version" --verify-tag --title "v$version" --notes-file "$notes_file"`, setting `notes_file` to that file. Verify an existing Release against the same tag instead of creating another one.

Documentation-only and workflow-only PRs need no changeset.

## License

The project is licensed under GPL-3.0-only (`LICENSE`). Distributing the software or a modified version requires releasing its source under the same license. Package metadata uses the SPDX identifier `GPL-3.0-only`. Change the license only as a deliberate project decision, and keep third-party notices for code or data copied from other projects. Record those notices in [`third-party-notices.md`](third-party-notices.md).

## File Conventions

- File and directory names are kebab-case: lowercase letters and digits joined by `-`. Suffixes after the stem follow the same rule (`fold.test.ts`, `vite.config.ts`), except a locale tag such as `zh-CN`.
- Files under `fixtures/` keep the agent log's names when those names are not kebab-case (`system_prompt.txt`, `tool_definitions.json`).
- Names fixed by convention or a platform keep their form: `README.md`, `README.zh-CN.md`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`, and `.gitlab/merge_request_templates/`.
- A code file (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.css`, and their variants) under `apps/`, `packages/`, or `scripts/` has at most 500 lines, tests included. Fixtures and documentation have no line limit. A file near the limit splits along a responsibility, not at an arbitrary line.

`node scripts/check-conventions.mjs` checks every tracked file. CI and the pre-commit hook run it.

The shared lint config adds three file rules: kebab-case names, at most 1000 lines, and one component per `.tsx` file (`react/no-multi-comp`, tests excluded). `check-conventions.mjs` stays, because its names and 500-line limit are stricter. A component used by one parent still gets its own file next to that parent. `apps/web/src/components/icons.tsx` is exempt in the root `vite.config.ts`: it is one family of stroke icons on a shared `Icon` base.

## Repository Architecture

- `packages/schema` and `packages/kernel` are domain rules. They must not import DevFrame or UI.
- Session reading is the external `@rivus/agent-kit`; `apps/cli` is the only package that imports it at runtime. Other packages may use its types with `import type`.
- `@rivus/agent-trace` (`apps/cli`) is the composition root and the only package that will be published. It bundles the other workspace packages. The Solid SPA is `@rivus/agent-trace-web` (`apps/web`).
- Fixtures live in `fixtures/` (`fixtures/sessions/<agent>/` for the session logs the conformance suites read).
- Shared lint, format, and `tsconfig` rules come from `@perfectpan/lint-config` (the `PerfectPan/lint-config` repository); see its README. The `lint` and `fmt` blocks of the root `vite.config.ts` spread its `vite-plus` export and `tsconfig.base.json` extends its tsconfig; both keep only this repository's rules. Change a shared default upstream, not here.
- `node scripts/check-layers.mjs` checks each workspace package's `@rivus/*` dependencies against the "May depend on" column of the [Layers table in `AGENTS.md`](AGENTS.md#layers). CI and the pre-commit hook run it.

## Runtime checks

`schema`, `kernel`, and `rpc` must not import `node:*` outside tests. Two checks enforce the rule, and the CI test job runs both:

1. oxlint `no-restricted-imports` on `node:*` in the root `vite.config.ts` (test files are excluded).
2. `node scripts/check-browser-bundle.mjs` bundles kernel and rpc with vite-plus's tsdown for platform `browser` and fails when the bundle imports anything but `devframe`, such as an unresolved `node:*` import.

See [`docs/architecture/overview.md`](docs/architecture/overview.md).

## Pull Request Gates

CI runs when a Draft PR becomes Ready for review. Ordinary pushes, main merges and metadata edits do not start
it. Finish local checks before requesting CI. After changing the head or base, update the branch and select Draft
then Ready again; confirm that the current PR comparison passed before merging. The single `test` job includes
the repository checks and the PR title and description checks; there is no separate Review
workflow. Editing the title or description does not re-run them; select Draft then Ready again after such an edit.
GitHub's PR checkout tests the merge result. A manual `workflow_dispatch` runs the selected branch as `manual checks`
for diagnosis, without the PR title or description checks, and does not satisfy the required PR
`test` check. Do not retry account/billing-blocked
runs until the blocker is resolved.

CI runs all package typechecks and builds Web before the CLI smoke tests so the tests reuse that Web output.
The tarball smoke step then builds `@rivus/agent-trace` with `vp pack` (`pnpm --filter '@rivus/agent-trace...' run build`, which also
runs the other packages' `tsc --noEmit` builds), packs it, and tests the installed tarball. If another package gains
a distinct build command, add it to CI. The CLI build smoke assertions share one subprocess. Dependency installation uses
`pnpm install --frozen-lockfile` with the committed lockfile; refresh the lockfile with `pnpm install` when dependency
inputs change. pnpm rejects versions published
less than a day ago (`minimumReleaseAge` in `pnpm-workspace.yaml`), so pick versions at least a day old when upgrading.
A `vite-plus` upgrade also moves the catalog's `vite` entry (the vite-plus-core override) to the same version, and
`apps/web`'s `rolldown` devDependency to that core's `bundledVersions.rolldown`; the CLI build fails while the
`rolldown` pin differs.

`pnpm/setup@v3` caches the pnpm content-addressed store, keyed by the lockfile's content hash. Every run still
executes `pnpm install --frozen-lockfile` and the checks. Installed workspace links, build outputs, credentials and
CI results are not cached. Keep cache storage inside the included repository allowance.

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
