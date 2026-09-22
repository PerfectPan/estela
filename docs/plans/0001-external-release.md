# Make the MVP cloneable by someone else

Copy of the plan template for this release cut. Sections that do not apply to a local tool are omitted.

- Status: draft
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-09-22
- Paired Spec: none

This plan decides how the existing local viewer becomes a repository another person can clone and run. It does not change runtime behavior. A Spec is required before a later PR changes the public command, file format, or supported hosts.

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Release
5. Verification
6. Risks, open questions, and follow-up

## 1. Background and goals

### 1.1 Current behavior and constraints

The MVP on `main` loads a canonical `agent-trace/v0` JSON file, or a Grok session directory, a Codex `rollout-*.jsonl`, or an OpenCode database addressed as `opencode.db#sessionId`. The Solid ledger shows turns and paired tool rows. The inspector shows Input, Output, Raw, and Model. Model calls `reconstruct` in the browser.

`packages/adapter-dsh` and `packages/adapter-claude-code` detect some paths and throw on load. The dev server defaults to port 7392 and can skip auth with `--no-auth`. Redaction is on unless `AGENT_TRACE_REDACT=0`. The redaction rule is a short secret-shaped pattern, not a review of the whole log.

The repository has no GitHub remote yet at the time this plan is written. Rush, Solid, Tailwind, shadcn-solid, and oxlint are already chosen. DevFrame is the shell only.

### 1.2 Problem

A checkout on the author's machine is not something another person can trust. The README still has to be proven on a clean CI runner. Unsupported hosts look like broken features. Sharing a static report can leak session text if redaction is treated as optional. There is no stated release boundary, so later work keeps mixing viewer features with repository hygiene.

### 1.3 Goals and success criteria

- A new clone, with only Node.js in the supported range, can install, test, and open the demo fixture.
- CI runs repository checks plus Rush lint, test, typecheck, and build.
- The README lists only hosts whose `load` succeeds.
- The default share path is a redacted static report. Turning redaction off is a local debug switch, not a documented share mode.
- No personal filesystem path, live session, or credential is tracked.

### 1.4 Non-goals

- Publishing packages to npm.
- Making the GitHub repository public. Visibility stays an owner decision after this plan's checks pass.
- Timeline overview, list virtualization, request dots, turn collapse, and a composer.
- Implementing dsh or Claude Code loaders.
- A multi-user server, account system, or upload endpoint.

## 2. Outline

### 2.1 Design principles

- The tracked repository is the product surface. A local session is input, not content to commit.
- Unsupported means the README does not mention it as available. A throwing adapter may stay in the tree only if the README says it does not load.
- One snapshot RPC stays the static-build contract. Do not add a paged RPC to make export work.

### 2.2 Boundaries and responsibilities

| Piece | Owns |
|---|---|
| `schema`, `kernel` | Trace shape, reconstruct, redact |
| Host adapters | Disk format to `Trace` |
| `devframe` | CLI, local server, SPA |
| `docs/` | Current behavior |
| `docs/plans/0001-external-release.md` | This release cut, until it is done |
| GitHub | Source, CI, issues |

DevFrame auth and static dump stay inside `packages/devframe`. Adapters do not open a network connection.

### 2.3 Main path

Someone clones the repository, runs Rush update and test, then starts the dev server with no `AGENT_TRACE_PATH`. The demo fixture opens. To inspect their own session they set `AGENT_TRACE_PATH` to a supported host path. To hand someone a report they run the static build, which embeds the redacted `getTrace` snapshot.

### 2.4 Design decisions

- **Clone and Rush, not npm.** The first external cut is a git repository. npm publish adds versioning, provenance, and a support promise this MVP does not have. Revisit only after the clone path is green on CI.
- **Keep the repository private until the checklist in section 4 passes.** Public visibility is not part of the implementation work.
- **Three hosts are the supported set.** Grok, Codex, and OpenCode already load. dsh and Claude Code stay unimplemented and are documented as not supported. Shipping a stub that throws is worse than an honest gap.
- **Redaction stays best-effort and default-on.** The plan does not claim secrets are gone. The static report path must not document `AGENT_TRACE_REDACT=0`.
- **Do not vendor `technical-design-docs`.** Plans use `docs/plans/0000-template.md`. The skill stays on the author machine.

## 3. Detailed design

### 3.1 Entry points and request path

The only supported entrypoints are:

- `node common/scripts/install-run-rush.js` for update, lint, test, typecheck, and build.
- `packages/devframe` `dev` for the local UI.
- `packages/devframe` `cli:build` for a redacted static report.

`AGENT_TRACE_PATH` selects the input. Unset means `fixtures/demo.trace.json`.

### 3.2 Interfaces

No new RPC and no schema version bump. `agent-trace/v0` stays the file a fixture and a static dump use.

`getTrace` remains one snapshot. The browser calls `reconstruct` from `@agent-trace/kernel/reconstruct` so the static page does not depend on a second RPC.

### 3.7 Compatibility and migration

Existing canonical JSON fixtures keep loading. Host paths that load today keep loading. A directory that the dsh or Claude adapter detects may still throw. That behavior stays until those adapters are either implemented or their `detect` returns false. This plan chooses the second option for the external cut: `detect` returns false, and `load` is not part of the supported path. That avoids a stranger hitting a deliberate throw.

### 3.8 Security and privacy

- Session files are read locally. The server binds localhost.
- `--no-auth` is documented only for a local demo. A non-loopback bind keeps DevFrame auth.
- Fixtures may contain only fake secret-shaped strings used by the redact test.
- `SECURITY.md` is the reporting path. Do not add a public upload form.

## 4. Release

This is a local tool, not a hosted rollout.

### 4.1 Gates

Ship the external cut only when all of these are true:

1. CI on `ubuntu-latest` passes repository checks, lint, test, typecheck, and build.
2. README quick start matches the commands CI runs, minus the dev server.
3. README host table matches adapters whose tests load a fixture.
4. `rg` over the tracked tree finds no personal home-directory path.
5. The demo server opens `fixtures/demo.trace.json` with redaction left on.

### 4.3 Rollback

The cut is documentation, CI, and adapter `detect` behavior. Revert the release PR. No migrated data and no published package to unpublish.

## 5. Verification

### 5.1 Functional checks

- `node common/scripts/install-run-rush.js test`
- `node common/scripts/install-run-rush.js build`
- Start the dev server with no `AGENT_TRACE_PATH` and open the demo ledger.

### 5.3 Compatibility checks

- One Grok directory, one Codex `rollout-*.jsonl`, and one `opencode.db#sessionId` still load in a local smoke test. Do not commit those files.

### 5.4 End-to-end acceptance

A clean GitHub Actions run is the acceptance evidence. A local `rush test` on the author machine is not.

## 7. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| GitHub private plan may reject branch protection | open question | Reviews are policy, not server-enforced | unconfirmed | Run the setup script; if apply fails, record the error and do not block the doc cut |
| Redaction misses secrets that do not match the pattern | risk | A shared HTML report can leak session text | unconfirmed | Document the limit in the README when the release PR updates it |
| dsh and Claude Code users expect support | follow-up | The README will say not supported | unconfirmed | Separate plans after this cut |
| npm publish | follow-up | Extra support promise | unconfirmed | Do not do it in this cut |

## Appendix

Rejected for this cut: copying the `technical-design-docs` skill into the repository, adding a paged trace RPC, and treating `--no-auth` as the default for a shared server.
