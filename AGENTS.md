# agent-trace

Generic inspect DevTool for coding-agent session logs. Not a harness. Not dsh Trajectory.

## Layers

| Directory | Package | Owns | May depend on |
|---|---|---|---|
| `apps/cli` | `@rivus/agent-trace` | Composition root: registers hosts, provides the Node runtime, the session catalog (discover, summaries, ref → file map that resolves TraceStore refs), starts the DevFrame server, terminal output, embeds the web build | every package; web's build output |
| `apps/web` | `@rivus/agent-trace-web` | Solid SPA: session browser, workspace, tokens, dictionaries | `rpc` (types), `kernel`, `schema` |
| `packages/rpc` | `@rivus/agent-trace-rpc` | RPC contracts (`list-sessions`, `load-trace`, `get-trace-view`, `get-event`, `reconstruct`, legacy `get-trace`), server handlers, and the TraceStore (ref resolution, in-flight loads, last 3 traces) over injected I/O, resolver, and session service | `kernel`, `schema` |
| `packages/runtime-node` | `@rivus/agent-trace-runtime-node` | `NodeIO` (`TraceIO` over `node:fs`), home directory, session index (`node:sqlite`) | `kernel`, `schema` |
| `packages/host-claude-code`, `host-codex`, `host-grok` | `@rivus/agent-trace-host-<id>` | One host each: layout knowledge, parsing, capabilities | `kernel`, `schema` |
| `packages/host-opencode`, `host-dsh` | `@rivus/agent-trace-host-<id>` | Kept, not registered in this release | `kernel`, `schema` |
| `packages/kernel` | `@rivus/agent-trace-kernel` | `TraceIO`, host protocol, `loadTrace`, `fold`, `reconstruct`, `redact`, `toView`, projections, conformance | `schema` |
| `packages/schema` | `@rivus/agent-trace-schema` | `Trace`, kinds, `shadowedBy`, `zod` schemas | no workspace package (external: `zod`) |

## Rules

- Canonical storage is ordered `events[]`; every event can return its original. The server reads it back from the event's source pointer (file, byte offset, length) for `get-event`; the view trace and the server's trace cache hold no originals. Turn, step, lane, and tree are kernel projections (`projectRequests`, `projectLanes`, `projectTurns`).
- Missing data is `unavailable`. Never invent.
- Compaction is `kind: 'compaction'` plus `shadowedBy` on hidden events.
- `reconstruct(trace, eventId)` is the product. A ledger without it is a transcript browser.
- `get-trace-view` is one snapshot blob (`toView`: no originals, strings capped, lowered only to fit the 12 MB budget); `get-event` returns one event in full. No paging RPC. DevFrame streaming carries load progress only (`load-progress`), never session follow.
- RPC handlers take an opaque session `ref` and resolve it through the shell's resolver (the session catalog on the dev server; `current` is the launch session); paths never cross the wire as refs.
- Adapters fail loud on unknown generations. Do not silently drop events.
- The session index (`~/.cache/rivus-agent-trace/index.sqlite`) is a cache: keyed by path, size, mtime, and `SUMMARY_VERSION`; a failed summary is never cached; `node:sqlite` is imported only in `packages/runtime-node`.
- Bump SUMMARY_VERSION in the kernel when summary numbers change meaning.
- URLs carry opaque session refs (a hash of host and path, plus the session id for the `path#id` form), never paths.
- UI strings go through `apps/web/src/i18n/` (`dictionary.en.ts` is the type source, `dictionary.zh-CN.ts` satisfies it). Session content never does.

## Tooling

- Rush + pnpm. Do not use a root `pnpm-workspace.yaml`.
- UI: Solid + Tailwind v4 + shadcn-solid (`@kobalte/core`). Not React shadcn.
- Lint is oxlint. No formatter is configured.
- A PR that changes shipped files under `apps/` or `packages/` carries a Rush change file; rules in `CONTRIBUTING.md#release-intent`. Do not edit generated changelogs or add a hand-written root `CHANGELOG.md`.
- Contribution workflow, Specs, and Plans live in `CONTRIBUTING.md`, `docs/specs/`, and `docs/plans/`. Do not copy the `technical-design-docs` skill into this repo.
- File and directory names are kebab-case, and a code file has at most 500 lines; rules in `CONTRIBUTING.md#file-conventions`.
- Every Spec and Plan ships with a `.zh-CN.md` reading copy in the same PR; rules in `CONTRIBUTING.md#bilingual-specs-and-plans`.

## Review Evidence

- PR titles must be English and follow `type(scope): summary`, including bot-generated release and dependency PRs such as `chore(release): version packages`; use `scripts/check-pr-title.sh` to verify them.
- PR descriptions must keep every template section and include motivation, implementation notes, exact validation commands, skipped gates with reasons, and follow-up risks. Do not add agent attribution lines such as "Generated with <tool>". Verify the body with `scripts/check-pr-body.sh` before opening or updating the PR. Bot-opened PRs are exempt from the description check, not the title check.
- If a claim depends on logs, screenshots, package output, deployed behavior, or generated artifacts, attach or link the evidence in the PR.
- Update the PR description after substantial code changes, review-driven revisions, rebases that change behavior, or validation reruns.
- Keep the GitHub PR template and the GitLab MR template in sync.

## Commands

```sh
./scripts/check-repository.sh
node scripts/check-doc-translations.mjs
node scripts/check-conventions.mjs
./scripts/check-pr-title.sh "<title>"
./scripts/check-pr-body.sh pr-body.md
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js lint
node common/scripts/install-run-rush.js test
node common/scripts/install-run-rush.js typecheck
node common/scripts/install-run-rush.js build
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
cd apps/cli && node ../../common/scripts/install-run-rushx.js dev -- --no-auth
```
