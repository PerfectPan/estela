# Plan 0004: Rename the project from agent-trace to Estela

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-12
- Paired Spec: none (a rename without changed behavior; issue #89, roadmap #88)

This plan renames the product, the published package, the command, the workspace packages, the
environment variables, the cache directory, and the format identifiers from agent-trace to Estela
in one PR. Behavior does not change.

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Rollout and stability
5. Verification
6. Execution plan
7. Risks, open questions, and follow-up

## 1. Background and goals

### 1.1 Current behavior and constraints

- The product is called agent-trace. The only published package is `@rivus/agent-trace` (bin
  `agent-trace`, released once as `0.1.0`); the workspace packages are `@rivus/agent-trace-<x>`
  and are bundled into it.
- The name also lives in data identifiers: the canonical trace's `schema: 'agent-trace'`, ATIF
  `extra.agent_trace`, the DevFrame id, RPC namespace and shared state `agent-trace:sessions`, the
  MCP tool prefix, the dev server path `/__agent-trace/`, default export file names, the report
  temp directory, localStorage keys, and the cache directory `rivus-agent-trace`.
- The project is 0.x and has no outside users. `@rivus/agent-kit` is a separate package and keeps
  its name.

### 1.2 Problem

"Agent Trace" is also the name of Cursor's code-attribution format, so the README carried a
disclaimer and searches for the name find the other project.

### 1.3 Goals and success criteria

- Every identifier family in 3.1 uses the new name.
- `git grep -i -E "agent[-_ ]?trace"` finds only the kept history in 3.2.
- Every gate in 6.4 passes.

### 1.4 Non-goals

- No change to behavior, no refactor, and no fix to unrelated stale docs.
- The logo artwork stays.
- No compatibility reading of the old names (3.3).

## 2. Outline

### 2.1 Design principles

- One PR renames every family, so no state mixes the two names.
- History stays as it was written.

### 2.2 Boundaries and responsibilities

The rename touches every workspace package, the root scripts, CI workflows,
`renovate.json`, `.changeset/`, and the docs. The GitHub repository rename and npm work stay with
the owner (section 7).

### 2.3 Main path

Scripted replacement over tracked files, one family at a time, followed by manual capitalization
of the product name in prose and a lockfile refresh with `pnpm install`.

### 2.4 Design decisions

| ID | Decision | Alternatives and reason |
| --- | --- | --- |
| D1 | The product name is "Estela" in prose and UI text; `estela` in commands, package names, and identifiers. | Lowercase everywhere matched the old style, but "Estela" is a proper name. |
| D2 | No fallback to old env vars, the old schema id, or the old cache. | A fallback reader costs code and tests for users that do not exist. |
| D3 | Pending changesets name `@rivus/estela`, and their text uses the new command and env var names. | They are unreleased; they become the first `@rivus/estela` changelog. |
| D4 | The released entries of `apps/cli/CHANGELOG.md`, `.changeset/ledger.yaml`, and the `v0.1.0` tag stay. The changelog heading is edited by hand to `# @rivus/estela`, with one line saying versions up to 0.1.0 were published as `@rivus/agent-trace`. | They record what was released under the old name. Changesets writes the heading only into an empty file and inserts every later entry below it, so without the edit the `@rivus/estela` entries would sit under the old name. |
| D5 | Plan 0003 keeps its quotes of the old `--version` output (`agent-trace/0.0.0`). | They are observed output from before that change. |

## 3. Detailed design

### 3.1 Renamed identifier families

| Old | New |
| --- | --- |
| Product name agent-trace / Agent Trace | Estela |
| `@rivus/agent-trace`, bin `agent-trace` | `@rivus/estela`, bin `estela` |
| `@rivus/agent-trace-<x>` (`web`, `e2e`, `rpc`, `kernel`, `schema`, `runtime-node`) | `@rivus/estela-<x>` |
| Root workspace name `agent-trace` | `estela` |
| `PerfectPan/agent-trace` in manifests, docs, `.changeset/config.json`, `renovate.json` | `PerfectPan/estela` |
| `AGENT_TRACE_*` env vars and the `AGENT_TRACE_BUNDLE` build constant | `ESTELA_*` |
| Cache directory `rivus-agent-trace` | `rivus-estela` |
| `schema: 'agent-trace'` (`TRACE_SCHEMA`, head check, fixtures) | `schema: 'estela'` |
| ATIF `extra.agent_trace` | `extra.estela` |
| OTLP `service.name` and scope name `agent-trace` | `estela` |
| DevFrame id and RPC namespace `agent-trace` (shared state `agent-trace:sessions`, stream `agent-trace:load-progress`, MCP tool `agent-trace_reconstruct`) | `estela` |
| Dev server path `/__agent-trace/` | `/__estela/` |
| Default export files `agent-trace-<session>.<format>.json`, report temp dir `agent-trace-report-*` | `estela-...` |
| localStorage keys `agent-trace-theme`, `agent-trace-locale` | `estela-theme`, `estela-locale` |
| Fallback agent label `agent-trace` in the trace id of a canonical trace with no agent | `estela` |
| Test and script temp names (`agent-trace-smoke`, `agent-trace-browser-`, ...) | `estela-...` |

The README drops the footer about Cursor's Agent Trace and gains one line on the Spanish meaning
(a ship's wake).

### 3.2 Kept history

- `apps/cli/CHANGELOG.md`: the released entries, and the line naming the package they were published as.
- `.changeset/ledger.yaml`: the `@rivus/agent-trace@0.1.0` record.
- `docs/plans/0003-cli-layers.md` and its reading copy: the old `--version` output.
- This plan and its reading copy, which name the old identifiers.
- The `v0.1.0` tag and Release.

### 3.3 Compatibility and migration

Nothing reads the old names. After the upgrade, `AGENT_TRACE_*` variables are ignored, a
canonical file with `schema: 'agent-trace'` is not recognized, the index is rebuilt under
`rivus-estela`, and theme and locale choices reset once. No CLI command writes canonical trace
files, so only the repository's own fixtures and `scripts/generate-trace.mjs` carry the schema id;
both change here. Trace ids for canonical traces without an agent change; trace ids are not
stored outside the cache. The changeset tells CLI users the new package, command, env vars, and
cache directory, and that the old cache directory can be deleted.

## 4. Rollout and stability

### 4.1 Gates and rollout stages

The PR merges after every gate in 6.4 passes. The owner then renames the GitHub repository and
publishes `@rivus/estela` (section 7). Links to `PerfectPan/estela` do not resolve until the
rename; after it, GitHub redirects the old URLs. `@changesets/changelog-github` reads
`PerfectPan/estela` from `.changeset/config.json`; if the Publish workflow's version job runs on
the merge commit before the rename and fails, rerun it after the rename.

### 4.3 Rollback

Revert the PR. No persisted data needs migrating back: the old cache directory is still on disk.
If `@rivus/estela` was already published, deprecate that version instead of unpublishing.

## 5. Verification

### 5.1 Functional checks

Unit, integration, smoke, and e2e suites run with the renamed identifiers; tests that compare the
command name, schema id, OTLP service name, MCP tool name, and server path expect the new values.

### 5.3 Compatibility checks

`node scripts/check-release-plan.mjs` passes with the pending changesets naming `@rivus/estela`.
`git grep -i -E "agent[-_ ]?trace"` lists only 3.2.

## 6. Execution plan

### 6.1 Preconditions

The new name and the decisions in 2.4 are approved in issue #89.

### 6.2 Completion contract

- 1.3 holds.
- One minor changeset for `@rivus/estela` describes the rename for CLI users.

### 6.3 Execution order

One batch, one PR.

#### Task 1: Plan

- Files: `docs/plans/0004-rebrand-estela.md`, `docs/plans/0004-rebrand-estela.zh-CN.md`, `docs/plans/README.md`
- Change: this plan and its reading copy; list it as active.
- Tests: `node scripts/check-doc-translations.mjs`
- Exit condition: the check passes.

#### Task 2: Rename

- Files: every tracked file in `git grep -l -i -E "agent[-_ ]?trace"` except 3.2; `pnpm-lock.yaml`; a new `.changeset/rebrand-estela.md`.
- Change: replace the families in 3.1 in this order: `PerfectPan/agent-trace`, `@rivus/agent-trace`, `rivus-agent-trace`, `AGENT_TRACE`, `agent_trace`, `Agent Trace`, `agent-trace`; then capitalize the product name in prose and UI text; remove the README footer and add the Spanish line in both READMEs; run `pnpm install`.
- Tests: the existing suites, with their expectations renamed.
- Exit condition: every row in 6.4 passes and the leftover grep lists only 3.2.

### 6.4 Validation ledger

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| 1 | `node scripts/check-doc-translations.mjs`, `node scripts/check-conventions.mjs`, `node scripts/check-release-plan.mjs` | pass |
| 1 | `pnpm install`, `node scripts/format.mjs --check`, `node scripts/lint-scripts.mjs`, `pnpm lint` | pass, lockfile has no old names |
| 1 | `pnpm test`, `pnpm typecheck`, `pnpm build` | pass |
| 1 | `node scripts/check-layers.mjs`, `node scripts/check-browser-bundle.mjs` | pass |
| 1 | `cd apps/e2e && pnpm run test:smoke`, `pnpm run test:e2e` | pass; the tarball installs the `estela` bin |
| 1 | `git grep -i -E "agent[-_ ]?trace"` | only 3.2 |

### 6.5 Rollback per batch

Revert the single PR before publishing. After publishing, see 4.3.

## 7. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| Rename the GitHub repository to `PerfectPan/estela` | follow-up | Links and the changelog generator point at the new name | repository owner | when this PR merges |
| Bootstrap-publish `@rivus/estela` and configure npm trusted publishing for it | follow-up | The Publish workflow cannot publish a package that does not exist on npm with trusted publishing | repository owner | before the first release |
| `npm deprecate @rivus/agent-trace` pointing to `@rivus/estela` | follow-up | Old installs see the new name | repository owner | after `@rivus/estela` is published |
| Version job may run before the repository rename | risk | The version PR is not opened until a rerun | repository owner | rename right after merging; rerun the Publish workflow if it failed |
| Update the GitHub repository description | follow-up | The repository page shows the old name | repository owner | with the repository rename |
