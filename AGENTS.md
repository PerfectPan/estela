# agent-trace

Generic inspect DevTool for coding-agent session logs. Not a harness. Not dsh Trajectory.

## Layers

| Directory | Package | Owns | May depend on |
|---|---|---|---|
| `apps/cli` | `@rivus/agent-trace` | Composition root: registers hosts, provides the Node runtime, the session catalog (discover, summaries, ref → file map that resolves TraceStore refs), starts the DevFrame server, terminal output, the report writer (`build` and `export-report` → one `index.html`), embeds the web build, rslib bundle (`dist/bin.mjs`, `dist/cli.mjs`, `dist/web/`) | every package; web's build output |
| `apps/e2e` | `@rivus/agent-trace-e2e` | Private. CLI smoke (`test:smoke`) and Playwright (`test:e2e`) suites on the packed tarball, synthetic fixture homes | nothing at runtime; test tooling only |
| `apps/web` | `@rivus/agent-trace-web` | Solid SPA: session browser, workspace, report mode, tokens, dictionaries | `rpc` (types), `kernel`, `schema` |
| `packages/rpc` | `@rivus/agent-trace-rpc` | RPC contracts (`list-sessions`, `load-trace`, `get-trace-view`, `get-event`, `reconstruct`, `export-report`, and `report-trace` in build mode only), `buildReport`, server handlers, and the TraceStore (ref resolution, in-flight loads, last 3 traces) over injected I/O, resolver, and session service | `kernel`, `schema` |
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
- A report (`build`, `export-report`) is always redacted, whatever `AGENT_TRACE_REDACT` says. It opens from `file://`, so everything it needs is inside its one `index.html`; the SPA enters report mode when it finds `<script id="report-trace">` and then calls no server.
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
- Keep changes scoped to the task. Do not commit local config, credentials, generated logs, temporary workspaces, build artifacts, or machine-specific paths.

## Review Evidence

- PR titles must be English and follow `type(scope): summary`, including bot-generated release and dependency PRs such as `chore(release): version packages`; use `gh repo-checks pr-title` to verify them.
- PR descriptions must have a Summary (what changed and why) and a Validation section (exact commands and results, skipped gates with reasons); add Risks when there are any. Do not add agent attribution lines such as "Generated with <tool>". Verify the body with `gh repo-checks pr-body` before opening or updating the PR. Bot-opened PRs are exempt from the description check, not the title check.
- If a claim depends on logs, screenshots, package output, deployed behavior, or generated artifacts, attach or link the evidence in the PR.
- Update the PR description after substantial code changes, review-driven revisions, rebases that change behavior, or validation reruns.
- Keep the GitHub PR template and the GitLab MR template in sync.

## Commands

```sh
gh extension install PerfectPan/gh-repo-checks
gh repo-checks repository
node scripts/check-doc-translations.mjs
node scripts/check-conventions.mjs
gh repo-checks pr-title "<title>"
gh repo-checks pr-body pr-body.md
node common/scripts/install-run-rush.js update
node common/scripts/install-run-rush.js lint
node common/scripts/install-run-rush.js test
node common/scripts/install-run-rush.js typecheck
node common/scripts/install-run-rush.js build
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
cd apps/cli && node ../../common/scripts/install-run-rushx.js dev -- --no-auth
cd apps/e2e && node ../../common/scripts/install-run-rushx.js test:smoke
cd apps/e2e && node ../../common/scripts/install-run-rushx.js test:e2e
```

`test:smoke` and `test:e2e` build `@rivus/agent-trace`, pack `apps/cli`, and install the tarball; neither is part of `rush test`. `test:e2e` needs `npx playwright install chromium` once (or `AGENT_TRACE_E2E_CHANNEL=chrome`). Never run `npm publish` or `rush publish`.
