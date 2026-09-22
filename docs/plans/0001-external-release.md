# Make the MVP runnable from a clean clone

- Status: draft
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-09-23
- Paired Spec: none

This plan covers the work required for another person to clone the repository and run the viewer on the demo fixture or on their own Grok, Codex, or OpenCode session. It does not change the trace file format or the ledger. A Spec is required before a later change to `reconstruct`, `agent-trace/v0`, or the supported host set.

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Release
5. Verification
6. Delivery
7. Risks, open questions, and follow-up

## 1. Background and goals

### 1.1 Current behavior and constraints

The private repository is `PerfectPan/agent-trace`. `main` is the MVP commit. This document is on the open pull request that adds the Spec and Plan workflow.

`loadTrace` (`packages/kernel/src/load.ts`) reads the path as canonical `agent-trace/v0` JSON first. If that parse fails, it asks each adapter, in order: Grok, OpenCode, Codex, Claude Code, dsh. The first adapter whose `detect` returns true runs `load`.

Verified loaders:

| Host | Input | Evidence |
|---|---|---|
| Canonical JSON | `fixtures/demo.trace.json` | kernel tests |
| Grok | session directory with `summary.json` and `updates.jsonl` | `parseGrokUpdates` test; a local session loaded in development |
| Codex | `rollout-*.jsonl` whose first record type is `session_meta` | `parseCodexRows` test; one local file loaded in development |
| OpenCode | `opencode.db#<session id>`, or `AGENT_TRACE_SESSION` when the database has one session | `parseOpenCodeSession` test; one local session loaded in development |

`packages/adapter-dsh` returns true for a `.zip` or a file named `session.jsonl`, `session.vN.jsonl`, or the same names with `.zst`, then throws. `packages/adapter-claude-code` returns true when the path contains `.claude/projects`, then throws. Because those adapters sit after the working ones, a Grok, Codex, or OpenCode path is not stolen. A dsh zip or a Claude project path fails with the throw, not with `UnsupportedTraceError`.

`getTrace` (`packages/devframe/src/rpc/functions/get-trace.ts`) loads `AGENT_TRACE_PATH`, or `fixtures/demo.trace.json` when that variable is unset. It runs `redact` unless `AGENT_TRACE_REDACT=0`. `redact` (`packages/kernel/src/redact.ts`) replaces strings matching `sk-`, `AKIA`, `ghp_`, or `xox[baprs]-` plus eight characters. It does not scan for other secrets. The SPA calls `reconstruct` in the browser from `@agent-trace/kernel/reconstruct`. `getTrace` is a snapshot query, so a static build can bake that one result. `reconstruct` is also registered as a snapshot query; DevFrame static dump falls back to the first baked result when arguments do not match, so the static page must keep using the in-browser function.

The dev server listens on port 7392. `--no-auth` disables DevFrame's localhost OTP. UI is Solid, Tailwind v4, and shadcn-solid. The monorepo is Rush. Node.js must be `>=20.11.0 <25`. CI in this pull request runs repository checks plus Rush lint, test, typecheck, and build on `ubuntu-latest`. That workflow has not run on `main` yet.

### 1.2 Problem

A person who is not the author cannot yet treat the repository as a finished tool.

- README commands assume a local Rush install. The command that works from a clean clone is `node common/scripts/install-run-rush.js`.
- dsh and Claude Code paths fail inside an adapter that already claimed the file. The error says the loader is unfinished, which reads as a defect in a supported host.
- The README lists those two hosts as not supported, but `detect` still claims their files.
- A static report is redacted only by the pattern above. Session text, file contents, and other tokens remain. Nothing in the current README states that limit next to the share command.
- CI is not evidence until it is green on the default branch.

### 1.3 Goals and success criteria

- From a clean clone, `node common/scripts/install-run-rush.js update`, then `test`, `typecheck`, `lint`, and `build`, pass on GitHub Actions.
- With `AGENT_TRACE_PATH` unset, the dev server opens `fixtures/demo.trace.json`.
- README host table matches adapters that both `detect` and `load` in tests: Grok, Codex, OpenCode, and canonical JSON.
- A dsh zip and a Claude Code project path produce `UnsupportedTraceError`, the same error as any other unknown file.
- The README states that redaction replaces only the patterns in `redact.ts`, and that `AGENT_TRACE_REDACT=0` is a local debug switch.

### 1.4 Non-goals

- Publishing packages to npm.
- Changing GitHub visibility. The repository is private. Making it public is a separate owner decision after the checks in section 4 pass.
- Timeline overview, list virtualization, request dots, turn collapse, and a composer.
- Implementing dsh or Claude Code parsers.
- A multi-user server, accounts, or an upload endpoint.
- A new trace schema version.

## 2. Outline

### 2.1 Design principles

- Tracked files are the product. A session on disk is input and is not committed.
- A host is supported only when `detect` and `load` both succeed on a fixture in CI.
- `getTrace` stays one snapshot. The static report does not add a paged read.

### 2.2 Boundaries and responsibilities

| Piece | Responsibility |
|---|---|
| `@agent-trace/schema`, `@agent-trace/kernel` | `Trace`, `reconstruct`, `redact`, `loadTrace` |
| `@agent-trace/adapter-grok`, `adapter-codex`, `adapter-opencode` | Host file to `Trace` |
| `@agent-trace/adapter-dsh`, `adapter-claude-code` | Stay in the tree. `detect` returns false until a real loader exists |
| `@agent-trace/devframe` | CLI, local server, SPA, static dump |
| `docs/` | Current behavior, updated in the same change as the behavior |
| This plan | Release decisions until the checks in section 4 pass |

Adapters do not open network connections. Auth and the static dump stay in the DevFrame package.

### 2.3 Main path

The reader clones the repository and runs Rush through `common/scripts/install-run-rush.js`. Tests pass. They start the dev server with no `AGENT_TRACE_PATH` and see the demo ledger. To read their own session they set `AGENT_TRACE_PATH` to a supported path. To give someone a report they run `cli:build`. That build calls `getTrace`, which redacts with the current pattern, and writes a static page. The page reconstructs from the baked trace in the browser.

### 2.4 Design decisions

**Distribution is a git clone.** npm publish needs versions, provenance, and a support promise the MVP does not have. Revisit only after the clone path is green on CI. Alternative considered: publish `@agent-trace/devframe` now. Rejected for this release because the bin still depends on a Rush workspace layout and unpublished sibling packages.

**dsh and Claude Code stop claiming files.** Alternative considered: leave `detect` true and document the throw. Rejected because `loadTrace` stops at the first positive `detect`, so the user never receives `UnsupportedTraceError`. Alternative considered: implement both parsers in this release. Rejected because dsh needs the format catalog and zstd restore, and Claude Code needs a parent-id tree. Those are separate plans. This release sets both `detect` functions to return false and leaves `load` throwing only if called directly.

**Redaction stays the current function.** Alternative considered: block static build until a broader secret scanner exists. Rejected because that scanner is not designed. The release documents the pattern and tells the reader to read the HTML before sending it. `AGENT_TRACE_REDACT=0` stays available for local debugging and is not listed as a way to share a report.

**Do not copy the `technical-design-docs` skill into the repository.** Plans use `docs/plans/0000-template.md`. The skill stays installed on machines that already have it.

## 3. Detailed design

### 3.1 Entry points and request path

Supported commands after this release:

- `node common/scripts/install-run-rush.js update`
- `node common/scripts/install-run-rush.js lint`
- `node common/scripts/install-run-rush.js test`
- `node common/scripts/install-run-rush.js typecheck`
- `node common/scripts/install-run-rush.js build`
- From `packages/devframe`: `node ../../common/scripts/install-run-rushx.js dev -- --no-auth` for a local demo
- From `packages/devframe`: `node ../../common/scripts/install-run-rushx.js cli:build` for a static report

`AGENT_TRACE_PATH` selects the file or directory. Unset means `fixtures/demo.trace.json`.

`--no-auth` is documented only for a loopback demo. A non-loopback bind keeps DevFrame authentication. This plan does not change that DevFrame default.

### 3.2 Interfaces

No new RPC. No schema version change.

`getTrace` remains `{ path, trace, fold }` and remains a snapshot query. The static page keeps calling `reconstruct` in the browser. The implementation PR removes `snapshot: true` from the `reconstruct` RPC, or stops registering it for static dump, so a baked dump cannot answer a different event id with the first snapshot. That is a proposed change. It is not present on `main`.

### 3.6 Failures and recovery

| Input | Result after this release |
|---|---|
| Valid `agent-trace/v0` JSON | That trace |
| Grok session directory | Grok trace |
| Codex rollout JSONL | Codex trace |
| `opencode.db` with several sessions and no id | Error that names the session count and the `#sessionId` form. This message already exists |
| dsh zip, Claude project path, other files | `UnsupportedTraceError` |
| Truncated or unknown host generation | The adapter throws. It does not drop records silently |

### 3.7 Compatibility and migration

Canonical fixtures and the three working host paths keep their current `load` behavior. The only behavior change is `detect` on the dsh and Claude Code adapters. Callers that depended on those throws will instead see `UnsupportedTraceError`. No stored trace file changes.

### 3.8 Security and privacy

Session files stay on the reader machine. The default bind is localhost. Fixtures may contain only the fake `sk-demo` string used by the redact test. `SECURITY.md` is the reporting path. This release does not add an upload form.

## 4. Release

This is a local tool. There is no traffic ramp.

### 4.1 Gates

The release pull request merges only when all of these are true:

1. GitHub Actions on `ubuntu-latest` passes `./scripts/check-repository.sh` and the four Rush commands in section 3.1.
2. The README quick start uses `node common/scripts/install-run-rush.js` and matches those commands.
3. The README host table lists canonical JSON, Grok, Codex, and OpenCode only.
4. A search of tracked files finds no personal home-directory path. The search is `rg` for `/Users/` and `/home/` outside `.git`.
5. With `AGENT_TRACE_PATH` unset, the dev server returns the demo page. This check is local. CI does not launch a browser in this release.

### 4.3 Rollback

Revert the release pull request. There is no published package and no migrated data.

## 5. Verification

### 5.1 Functional checks

- `node common/scripts/install-run-rush.js test`
- `node common/scripts/install-run-rush.js build`
- Dev server with `AGENT_TRACE_PATH` unset, then open `http://localhost:7392/__agent-trace/`

### 5.2 Failure checks

- A temporary file whose name matches the current dsh `detect` rule loads as `UnsupportedTraceError` after the `detect` change.
- A path containing `.claude/projects` does the same.
- `opencode.db` with more than one session and no fragment still errors with the session-count message.

### 5.3 Compatibility checks

One Grok directory, one Codex rollout file, and one `opencode.db#sessionId` still load. Those files stay untracked. Record the command and the event count in the release pull request. Do not paste session text.

### 5.4 End-to-end acceptance

A green GitHub Actions run on the release pull request is the acceptance evidence. A test run on the author machine is not a substitute.

## 6. Delivery

One person can do this. Owners and dates are unconfirmed. The estimates below assume the author already has Rush and the three host samples locally. They are not a commitment.

### 6.1 Work split

| Area | Change | Owner | Depends on | Effort |
|---|---|---|---|---|
| dsh and Claude Code adapters | `detect` returns false; add a test that `loadTrace` throws `UnsupportedTraceError` | unconfirmed | this plan accepted | estimate: under one day |
| README and `docs/development/setup.md` | Commands, host table, redaction limit | unconfirmed | adapter change | estimate: under one day |
| DevFrame RPC | Stop baking `reconstruct` as a static snapshot | unconfirmed | none | estimate: under one day |
| CI | Confirm `.github/workflows/ci.yml` is green on the release pull request | unconfirmed | the edits above | estimate: under one day, plus one CI rerun if the runner fails |

### 6.3 Release order

Land the adapter and RPC edits with their tests first, then the README, then confirm CI on that same pull request. The documentation must not claim a host is supported before the test exists.

## 7. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step or deadline |
|---|---|---|---|---|
| Private GitHub plan may reject branch protection | open question | Reviews stay a written rule, not a server rule | unconfirmed | Run `scripts/configure-github-repository.sh --repo PerfectPan/agent-trace`. If `--apply` fails, record the error and do not block the release |
| `redact` misses secrets outside its pattern | risk | A static HTML file can still contain session text | unconfirmed | README states the pattern and tells the reader to inspect the file before sending it |
| Readers expect dsh or Claude Code | follow-up | README will say those hosts are not supported | unconfirmed | Separate plans after this release |
| npm publish | follow-up | Adds a support promise | unconfirmed | Not in this release |
| Static `cli:build` has not been executed on CI | open question | The share path might fail even when `rush build` passes | unconfirmed | The release pull request runs `cli:build` once locally and records the exit code |

## Appendix

Rejected for this release: copying the `technical-design-docs` skill into the repository, adding a paged trace read, and implementing the dsh or Claude Code parsers.
