# Contributing

## First Contribution

1. Clone the repository: `git clone https://github.com/PerfectPan/estela.git`.
2. Use Node.js `^26.13.1` (26.13.1 or later within 26.x); `pnpm install` rejects other versions. pnpm switches to the version the root `package.json` pins.
3. Install the dependencies and the Git hooks: `pnpm install`, then `./scripts/install-git-hooks.sh`.
4. Before you open a pull request, run the five gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `node scripts/format.mjs --check`. The pre-commit hook runs the repository checks.
5. Run the app on synthetic sessions as [Development](docs/development/setup.md#run-the-ui) shows.

Ask questions and propose changes in a [GitHub issue](https://github.com/PerfectPan/estela/issues/new/choose) (bug, feature, or task template). A typo or narrow documentation fix can go straight to a pull request. The sections below are the full rules.

## Development Setup

Use Node.js `^26.13.1` (26.13.1 or later within 26.x): the root `package.json` and `devEngines.runtime` reject development runtimes outside this range during `pnpm install`. The CLI itself runs on Node.js 24 or later, and `apps/cli/bin.mjs` exits before it loads the CLI when Node is older. pnpm switches itself to the version pinned by `packageManager` in the root `package.json`, and installs from the public npm registry set in `pnpm-workspace.yaml`, whatever default registry your `~/.npmrc` names; a scoped `@scope:registry` entry there still applies.

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
cd apps/cli && pnpm run dev
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

`@rivus/estela` is the only published package, and it bundles every other workspace package. A PR that changes what it ships carries a changeset under `.changeset/` naming `@rivus/estela`. "What it ships" is any file under `apps/` or `packages/` except tests, fixtures, and Markdown, plus lockfile changes that affect bundled dependencies. An edit that only touches a bundled private package needs the changeset on the CLI package too: the version bump and the changelog line ride on the published package. Changes limited to root release-tool dependencies need no release changeset.

- Create the file with `pnpm exec changeset --patch @rivus/estela --message "<text>"` (use `--minor` or `--major` for another bump), or run `pnpm exec changeset` interactively. Rename the generated random file name to a kebab-case slug.
- The bump type follows semver for users of the CLI: `major` for a breaking change once 1.0 exists, `minor` for a new capability, `patch` for a fix. `none` on the public CLI records an internal change without a release or changelog line; native versioning consumes it even when no version changes. `pnpm exec changeset --empty` is also valid, but an empty marker alone leaves the workflow in `none` mode until a release changeset is added.
- The message is one or two sentences written for users of the CLI. It becomes a line in the generated `CHANGELOG.md`.
- CI runs `gh repo-checks release-plan` (v1.4.0 or later) from [PerfectPan/gh-repo-checks](https://github.com/PerfectPan/gh-repo-checks), which validates the configuration and every pending changeset with the installed Changesets, without filtering committed records or depending on a local base branch. Records for private or ignored packages that Changesets skips are rejected because native versioning leaves them pending. So is a `major` record while `@rivus/estela` is 0.x: going 1.0 is a deliberate decision, made by listing `allow-major @rivus/estela` in `.github/repo-checks.conf` in the PR that adds the record. Public `none` records, empty changesets, and a version PR with no remaining changesets are valid. CI does not verify that each shipped change has a changeset; the PR template carries the reminder. One exception: a PR that changes `docs/reference/public-interface.md` changes a covered surface, so `node scripts/check-release-intent.mjs` fails it unless it adds or edits a changeset that releases `@rivus/estela` (`patch`, `minor`, or `major`). The script checks only that one exists; the level follows the document's [version policy](docs/reference/public-interface.md#version-policy) and is checked in review. Locally it compares `HEAD` with its merge base on `origin/main`.
- On a push to `main`, the [Publish workflow](#publishing-to-npm) opens or updates the `chore(release): version packages` PR. The native `changeset version` consumes pending changesets, writes `apps/cli/CHANGELOG.md` through `@changesets/changelog-github`, and applies the version bump. Each update leaves the PR in Draft; a maintainer marks it Ready for review to start CI, then merges after CI passes.
- `.changeset/config.json` disables versioning and tagging private packages. The existing `.changeset/ledger.yaml` is a read-only pnpm history record; Changesets CLI neither reads nor extends it. Existing changelog entries and the historical `v0.1.0` tag and Release remain intact.
- Release notes come only from changesets. Do not edit the generated changelog or keep a hand-written root `CHANGELOG.md` beside it.

### Bot Pull Requests

- **Renovate version PRs**: [`renovate.json`](renovate.json) enables the npm manager (including pnpm) and the
  GitHub Actions manager. Renovate is configured as the routine version updater for these ecosystems.
  Renovate checks on Mondays from 00:00 to 06:59 in Asia/Shanghai, waits seven days after a release, and opens at
  most five concurrent version-update PRs. The waiting period stays above the workspace's one-day install policy in
  [`pnpm-workspace.yaml`](pnpm-workspace.yaml). `@rivus/*` packages are exempt from the wait, so a kit release
  reaches this repository in the next run. `rangeStrategy: "bump"` updates declared ranges and regenerates the pnpm
  lockfile through `pnpm install`.

  The catch-all groups separate minor/patch updates from majors. Later rules give the `packages:vitePlus` toolchain
  its own group and `@rivus/agent-kit` a group of its own, so a kit release is reviewed separately from routine
  updates; if a package adopts an Effect entry, add `effect` to that group.

  Node upgrades remain deliberate: `engines`, `devEngines.runtime`, workflow runtime versions extracted from
  `pnpm/setup` (`github-actions` / `node-version`), and major `@types/node` updates are disabled.
  `@perfectpan/lint-config` stays disabled because it is a Git dependency whose upgrades need accompanying code fixes.

  Lock-file maintenance runs on the first day of each month from 00:00 to 06:59 in Asia/Shanghai.

  Renovate opens a **Dependency Dashboard** issue through `config:recommended`; use its checkboxes to retry or
  recreate an update. npm security findings come from Renovate's OSV checks (`osvVulnerabilityAlerts`), and
  `vulnerabilityAlerts.rangeStrategy: "bump"` keeps security fixes on the tested `pnpm install` path. Security PRs
  can bypass release-age and schedule limits. OSV checks do not prove that Renovate can read GitHub Dependabot alerts.

  GitHub Actions minor and patch updates have their own group, separate from npm. Each Actions major update is
  reviewed separately. Workflows keep their major-version action tags; automatic merging is disabled for all
  Renovate PRs, and required CI must pass before a maintainer merges. Workflow-only updates need no changeset.

- **Rollout and security ownership**: this configuration does not install or authorize the Renovate App and does
  not change GitHub repository security settings. At the 2026-11-03 adoption baseline, `main` had neither Renovate
  nor Dependabot version-update configuration, so this change adds no temporary Dependabot configuration.
  Introduce the initial configuration through normal PR review. Once it is available on the default branch,
  verify a real hosted run using this policy with npm and GitHub Actions extraction, the Dependency Dashboard,
  and update-PR creation when an update is available. Keep rollout under this policy marked unverified until
  this evidence is recorded. Local config validation and extraction are not evidence of a hosted run. Do not
  add a second routine updater while Renovate owns these ecosystems.

  Rollout snapshot (2026-11-03): the owner authorized this repository for the existing Renovate App; its existing
  permissions include reading Dependabot alerts and writing workflows. The [hosted onboarding run](https://developer.mend.io/github/PerfectPan/agent-trace/-/job/6df4e1d0-a6af-4e67-a065-da20b0dc27df)
  completed at 05:28:06 UTC with exit code 0 against `main` at
  `4d9610c3d1d9b8e5a048f9f6269bec2568c1e785`: it extracted 2 GitHub Actions files / 21 dependencies and
  9 npm files / 89 dependencies, and created [onboarding PR #73](https://github.com/PerfectPan/estela/pull/73).
  Its result was `onboarding` with `onboarded: false`; it used generated onboarding configuration, not this
  hand-authored policy. A Dependency Dashboard and an actual dependency-update PR with passing CI remain
  unverified. Keep [issue #59](https://github.com/PerfectPan/estela/issues/59) open until its remaining
  acceptance criteria, including a real kit-update PR and CI, are met.

  At the same audit, the repository's [security settings](https://github.com/PerfectPan/estela/settings/security_analysis)
  showed the dependency graph, Dependabot alerts, and Dependabot security updates disabled. The hosted run
  reported that vulnerability alerts were not enabled. App permission alone does not prove alert-to-fix
  coverage, and no security setting was changed as part of this rollout.

  Keep the dependency graph and Dependabot alerts enabled independently of the version-update bot. If either is
  disabled, enabling it is a separate owner action; the config does not enable it. Security-fix PR ownership is
  also separate from `.github/dependabot.yml`. Before changing the existing security-update setting, verify the
  Renovate App's Dependabot-alert read permission and a hosted run that reads the repository's alerts, then
  confirm a security fix can produce a PR and pass required CI. OSV support alone is not that verification.
  Once coverage is demonstrated, the owner can select Renovate as the primary security-PR owner and explicitly
  disable Dependabot security updates, leaving the dependency graph and alerts enabled. Until then, preserve
  any existing security-PR coverage. If alerts or security updates are already disabled, record that gap and
  confirm the intended owner settings separately; do not describe the config-only change as security coverage.

- **Changesets**: bot PRs carry none. Because the lockfile counts as what the CLI ships, an npm update that passes
  CI still needs a patch changeset for `@rivus/estela` added by the reviewer before merging (`pnpm exec changeset
  --patch @rivus/estela --message "..."`), per the Release Intent rules above. Lock-file-only updates
  follow the same rule when a bundled dependency changed the shipped output.

### Publishing to npm

`.github/workflows/publish.yml` keeps the npm trusted-publisher workflow filename and calls the shared release workflow `PerfectPan/gh-repo-checks/.github/workflows/npm-release.yml@v1`; its [runbook](https://github.com/PerfectPan/gh-repo-checks/blob/v1/docs/npm-release.md) describes each job and its recovery. On every push to `main`, its read-only select job uses the native `select-mode` action: `version` for pending release changesets, `none` for only empty changesets or no unpublished versions, and `publish` for packages ready to publish or tag. In `version` mode it runs `gh repo-checks release-plan` again, and in both modes `gh repo-checks first-publish` checks that the package already exists on npm. Version mode updates the draft version PR with `pnpm exec changeset version`. Publish mode runs, in a read-only job, the CLI smoke tests against a production-built, installed tarball and `pnpm --filter '@rivus/estela...' audit --audit-level=high`, which covers the CLI and every workspace package it bundles, dev dependencies included because the CLI bundles its own; the scope also takes in build tooling such as Vite+ and TypeScript, so a high advisory there blocks a release too, a deliberate trade for not missing a bundled one. It then packs that build. A separate publish job, the only one with `id-token: write`, installs without lifecycle scripts, publishes the packed tarball with native `changeset publish`, and creates the tag and GitHub Release. A repeated `main` push with no new release skips the smoke build and the publish jobs.

Manual dispatch is also restricted to `main` and defaults to `dry-run`. The dry-run job is read-only: it runs the tarball smoke and the release's dependency audit, saves the native `changeset publish-plan` JSON, and packs the CLI with `pnpm pack`. It never calls a publish command, creates a tag or Release, or requests an OIDC publishing token. The plan and archive are saved as the `release-dry-run` artifact. Unchecking `dry-run` runs the shared release workflow instead: it rebuilds the version PR while release changesets are pending, and otherwise publishes any unpublished version. To retry a failed release, use **Re-run failed jobs** on that run, which keeps its commit and packed tarball.

The workflow supports [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): only the publish job has `id-token: write`, which the publishing tool uses for a short-lived credential. Configure the package's trusted publisher on npmjs.com with GitHub owner `PerfectPan`, repository `estela`, workflow filename `publish.yml`, and no environment. npm checks this calling workflow's file name, not the shared workflow it calls. Enable **Allow npm publish**: new trusted publishers permit staged publishing by default. Private GitHub repositories can use trusted publishing; provenance attestations additionally require a public repository and a public npm package.

A new package must exist before npm accepts a trusted publisher: publish an empty bootstrap prerelease from a temporary directory using local npm login and 2FA, configure its trusted publisher, then enable the automatic version flow. Workflow publishing uses only OIDC and no repository npm token secret.

A new trusted publisher expires unless it completes a successful publish within two days. If the release is delayed, recreate the expired configuration before publishing; a dry run does not validate it.

A real publish uses Changesets CLI v3's registry checks and publish plan. Only `@rivus/estela` is public; the internal packages remain private, unversioned, and untagged. The pack job packs the production build that the smoke suite left in `apps/cli/dist` with `pnpm pack`, which rewrites `workspace:` and `catalog:` specifiers, rather than reusing the smoke archive, and the publish job uploads that tarball unchanged. The Action reads the CLI's structured output to create tags and Releases and reports its `published` and `published-packages` outputs. No custom summary parser or tag/Release script is used.

New workspace release tags use the native `@rivus/estela@<version>` format. Release notes come from the corresponding generated `apps/cli/CHANGELOG.md` section. A publish failure still fails the job even if an upload was accepted; do not infer success from an output containing a package name. This repository publishes one package, so there is no partial multi-package batch to coordinate. Native publishing skips public versions already on npm and does not repair their missing tags or Releases; use the recovery steps below.

If the workflow fails before uploading, rerun it. If an upload may have succeeded, including an availability timeout, query the exact version first:

```bash
version=0.1.0 # Use the failed run's version.
npm view "@rivus/estela@$version" name version dist gitHead --json --registry https://registry.npmjs.org/
```

Authentication, network, and other query failures do not establish that a version is absent. An `E404` after an accepted upload or an availability timeout can mean the package is not visible yet: wait and query again without re-uploading. Rerun publishing only after confirming that the upload was not accepted. If the version exists, do not republish it or rerun the whole workflow. Never overwrite or unpublish an existing version to recover. Complete only the missing tag and Release:

1. Use a clean checkout of the original run's `GITHUB_SHA`. Confirm the published package came from that run using its publish output and registry metadata; check `gitHead` against the commit when the field is present. Stop if the package's source cannot be confirmed.
2. Set `tag="@rivus/estela@$version"` for a native release (`tag="v0.1.0"` for the historical release). Inspect it with `git ls-remote --tags origin "refs/tags/$tag" "refs/tags/$tag^{}"`. An existing tag must resolve to the original commit. If absent, set `release_sha` to the original run's SHA and run `git push origin "$release_sha:refs/tags/$tag"`. Stop on any conflict; do not move or force-push a tag.
3. If the GitHub Release is missing, save the body of that version's `apps/cli/CHANGELOG.md` section to a temporary notes file, then run `gh release create "$tag" --verify-tag --title "$tag" --notes-file "$notes_file"`, setting `notes_file` to that file. Verify an existing Release against the same tag instead of creating another one.

Documentation-only and workflow-only PRs need no changeset.

## License

The project is licensed under GPL-3.0-only (`LICENSE`). Distributing the software or a modified version requires releasing its source under the same license. Package metadata uses the SPDX identifier `GPL-3.0-only`. Change the license only as a deliberate project decision, and keep third-party notices for code or data copied from other projects. Record those notices in [`third-party-notices.md`](third-party-notices.md).

## File Conventions

- File and directory names are kebab-case: lowercase letters and digits joined by `-`. Suffixes after the stem follow the same rule (`fold.test.ts`, `vite.config.ts`), except a locale tag such as `zh-CN`.
- Files under `fixtures/` keep the agent log's names when those names are not kebab-case (`system_prompt.txt`, `tool_definitions.json`).
- Names fixed by convention or a platform keep their form: `README.md`, `README.zh-CN.md`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `SECURITY.md`, `SKILL.md` (an agent skill), `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`, and `.gitlab/merge_request_templates/`.
- A code file (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.css`, and their variants) under `apps/`, `packages/`, or `scripts/` has at most 500 lines, tests included. Fixtures and documentation have no line limit. A file near the limit splits along a responsibility, not at an arbitrary line.

`node scripts/check-conventions.mjs` checks every tracked file. CI and the pre-commit hook run it.

The shared lint config adds three file rules: kebab-case names, at most 1000 lines, and one component per `.tsx` file (`react/no-multi-comp`, tests excluded). `check-conventions.mjs` stays, because its names and 500-line limit are stricter. A component used by one parent still gets its own file next to that parent. `apps/web/src/components/icons.tsx` is exempt in the root `vite.config.ts`: it is one family of stroke icons on a shared `Icon` base.

## Repository Architecture

- `packages/schema` and `packages/kernel` are domain rules. They must not import DevFrame or UI.
- Session reading is the external `@rivus/agent-kit`; `packages/server` reads sessions through it at runtime, and `apps/cli` imports only its `redact` and `node` entries at runtime, and the kernel only the import-free `@rivus/agent-kit/cost` and `@rivus/agent-kit/cost/prices` (see the rule in `AGENTS.md`). Other packages may use its types with `import type`.
- `@rivus/estela-server` (`packages/server`) composes the server: `createEstelaServer` returns the DevFrame definition whose `setup` builds and binds the services. `@rivus/estela` (`apps/cli`) is the command line that calls it and the only published package. It bundles the other workspace packages. The Solid SPA is `@rivus/estela-web` (`apps/web`).
- Fixtures live in `fixtures/` (`fixtures/sessions/<agent>/` for the session logs the conformance suites read).
- Shared lint, format, and `tsconfig` rules come from `@perfectpan/lint-config` (the `PerfectPan/lint-config` repository); see its README. The `lint` and `fmt` blocks of the root `vite.config.ts` spread its `vite-plus` export and `tsconfig.base.json` extends its tsconfig; both keep only this repository's rules. Change a shared default upstream, not here.
- `node scripts/check-layers.mjs` checks each workspace package's `@rivus/*` dependencies against the "May depend on" column of the [Layers table in `AGENTS.md`](AGENTS.md#layers). CI and the pre-commit hook run it.

## Runtime checks

`schema`, `kernel`, and `rpc` must not import `node:*` outside tests. Two checks enforce the rule, and the CI test job runs both:

1. oxlint `no-restricted-imports` on `node:*` in the root `vite.config.ts` (test files are excluded).
2. `node scripts/check-browser-bundle.mjs` bundles kernel and rpc with vite-plus's tsdown for platform `browser` and fails when the bundle imports anything but `devframe`, such as an unresolved `node:*` import.

See [`docs/architecture/overview.md`](docs/architecture/overview.md).

## Pull Request Gates

CI listens for PRs being opened, reopened, updated with new commits (`synchronize`), or marked Ready for review.
The `test` job runs for non-Draft PRs, including ordinary and Renovate PRs opened directly as Ready. New commits
on a Ready PR run CI automatically; they no longer require another Draft-to-Ready transition. Keep work in Draft
until local checks are finished. When a Draft PR event starts this workflow, its `test` job is skipped. GitHub
reports that skipped job as successful, but the skipped status is not validation evidence. Mark the PR Ready and confirm that the actual `test` and `platforms` jobs ran
and passed for its current head and merge result before merging. Release PRs still return to Draft on every
version update and wait for a maintainer to mark them Ready.

There is no general `push` trigger: pushes to branches without a PR and main merges do not trigger this
workflow. Draft PR updates skip its `test` job. Metadata edits also do not trigger it. After changing only the title, description, or base, refresh the branch if needed
and select Draft then Ready again to validate the current comparison and metadata. The single `test` job
includes repository checks and the PR title and description checks; there is no separate Review workflow.
GitHub's PR checkout tests the merge result. A manual `workflow_dispatch` runs the selected branch as `manual checks`
for diagnosis, without the PR title or description checks, and does not satisfy the required PR
`test` check. Do not retry account/billing-blocked
runs until the blocker is resolved.

CI runs all package typechecks and builds Web before the CLI smoke tests so the tests reuse that Web output.
The tarball smoke step then builds `@rivus/estela` with `vp pack` (`pnpm --filter '@rivus/estela...' run build`, which also
runs the other packages' `tsc --noEmit` builds), packs it, and tests the installed tarball. If another package gains
a distinct build command, add it to CI. The CLI build smoke assertions share one subprocess. The budgets step
(`node scripts/check-budgets.mjs`) then runs on that build and writes its measured-vs-budget table to the job summary;
the budgets and their reasons live in `scripts/budgets/budgets.mjs`. The `platforms` job runs beside `test` on the same
events: the unit suites on macOS and Windows, and the smoke suite on Linux, macOS, and Windows with the installed CLI on
Node.js 24 (through `ESTELA_SMOKE_NODE`) and 26. The budgets and the Playwright suite run in `test` only, because their
numbers are set on Linux runners. Text files check out with LF on every system (`.gitattributes`), because fixtures are
read back by byte offset. Dependency installation uses
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

Workflows reference actions by their latest major version tag, such as `actions/checkout@v7`, not by commit SHA. Changesets sub-actions are pinned to the shared `v2.1.2` baseline because their CLI v3 inputs and publish-plan behavior are part of the release migration. Renovate proposes action-version updates for review; keep workflow structure synchronized with `PerfectPan/project-template` when adopting template changes.

## Local Git Hooks

```bash
./scripts/install-git-hooks.sh
```

The pre-commit hook runs `git diff --cached --check`, `gh repo-checks repository --staged` (without the extension it warns and skips that check), `node scripts/check-doc-translations.mjs`, `node scripts/check-conventions.mjs`, `node scripts/check-layers.mjs`, `node scripts/format.mjs --check`, and `node scripts/lint-scripts.mjs`. Hooks are a local guardrail; CI and branch protection remain the authoritative enforcement because hooks can be missing or bypassed.

If `core.hooksPath` is already set to another path, `scripts/install-git-hooks.sh` fails instead of overwriting it. Re-run with `--force` only after confirming the existing hooks can be replaced or moved into `.githooks`.

## Repository Setup

After the GitHub repository exists, preview branch protection with:

```bash
gh repo-checks protect --repo PerfectPan/estela --no-review-checks --check test
```

The command requires pull requests, one approving review (fresh after new pushes), linear history, resolved conversations, and the CI `test` check. This repository has no Review workflow; its review checks run inside `test`. `--no-review-checks` therefore drops the default `repository checks`, `conventional PR title`, and `PR description` contexts. A single maintainer cannot approve their own pull requests; pass `--approvals 0` to keep the other protections without a review requirement. If the repository already uses a ruleset, add these checks to the ruleset instead of layering classic branch protection on top.

Apply it only when the repository plan allows branch protection. Do not treat a failed apply on a private repository as a product defect.

## Security Reports

Use `SECURITY.md`. Do not include secrets or private filesystem paths in public issues or pull requests.
