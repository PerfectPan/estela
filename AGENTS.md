# Estela

Generic inspect DevTool for agent session logs. Not a harness. Not dsh Trajectory.

## Layers

| Directory | Package | Owns | May depend on |
|---|---|---|---|
| `apps/cli` | `@rivus/estela` | The published command line: the command routes (`@bomb.sh/router`), terminal output, exit codes and the failure map, browser opening, the ATIF and OTLP exports, the package name, version, and web build it hands the server factory (`src/server.ts`), starts the DevFrame dev and MCP servers from the factory's definition, embeds the web build, `vp pack` bundle (`dist/bin.mjs`, `dist/cli.mjs`, `dist/web/`) | every package; web's build output |
| `apps/e2e` | `@rivus/estela-e2e` | Private. CLI smoke (`test:smoke`) and Playwright (`test:e2e`) suites on the packed tarball, synthetic fixture homes | nothing at runtime; test tooling only |
| `apps/web` | `@rivus/estela-web` | Solid SPA: session browser, workspace, report mode, tokens, dictionaries | `rpc` (types), `kernel`, `schema`, `@rivus/agent-kit` (types) |
| `packages/server` | `@rivus/estela-server` | The server composition: `createEstelaServer` returns the DevFrame definition whose `setup` builds and binds the services, session reading through `@rivus/agent-kit` (runtime), the session catalog (discover, summaries, trace id → target map that resolves TraceStore trace ids), the TraceStore over Node reads, the report writer (`build` and `export-report` → one `index.html`), the MCP agent tools (`src/agent-tools/`) | `rpc`, `kernel`, `schema`, `runtime-node`, `@rivus/agent-kit` |
| `packages/rpc` | `@rivus/estela-rpc` | RPC contracts (`list-sessions`, `load-trace`, `get-trace-view`, `get-event`, `reconstruct`, `export-report`, and `report-trace` in build mode only), `buildReport`, server handlers, and the TraceStore (trace id resolution, in-flight loads, last 3 traces) over injected reads (`SessionFs`), resolver, and session service | `kernel`, `schema`, `@rivus/agent-kit` (types) |
| `packages/runtime-node` | `@rivus/estela-runtime-node` | home directory, session index (`node:sqlite`) | `kernel`, `schema`, `@rivus/agent-kit` (types) |
| `packages/kernel` | `@rivus/estela-kernel` | canonical-file head check, `fold`, `reconstruct`, `diffContext` (two reconstructions of one lane compared), `toView`/`fitView`, projections, list-price cost (`priceTrace` over the kit's `/cost`, `snapshotPricing` over its `/cost/prices`), the ATIF and OTLP export projections (`toAtif` → ATIF v1.8, `toOtlp` → OTLP/JSON with the GenAI attributes of the pinned semconv version), the `SessionFs` read shape | `schema`, `@rivus/agent-kit` (types; `/cost` and `/cost/prices` at runtime) (external: `zod`) |
| `packages/schema` | `@rivus/estela-schema` | `Trace`, kinds, `shadowedBy`, event payload types built on the kit's, `zod` schemas | `@rivus/agent-kit` (types); no workspace package (external: `zod`) |

## Rules

- Canonical storage is ordered `events[]`; every event can return its original. The server reads it back for `get-event` through the event's source pointer and the platform: a byte range in a plain file, the kit's reader for a compressed log (a decompressed offset) or a SQLite row; the view trace and the server's trace cache hold no originals. Turn, step, lane, and tree are kernel projections (`projectRequests`, `projectLanes`, `projectTurns`).
- Missing data is `unavailable`. Never invent.
- Compaction is `kind: 'compaction'` plus `shadowedBy` on hidden events.
- `reconstruct(trace, eventId)` is the product. A ledger without it is a transcript browser.
- `get-trace-view` is one snapshot blob (`toView`: no originals, strings capped, lowered only to fit the 12 MB budget); `get-event` returns one event in full. No paging RPC. DevFrame streaming carries load progress only (`load-progress`), never session follow.
- A report (`build`, `export-report`) is always redacted, whatever `ESTELA_REDACT` says. It opens from `file://`, so everything it needs is inside its one `index.html`; the SPA enters report mode when it finds `<script id="report-trace">` and then calls no server.
- The export projections (`toAtif`, `toOtlp` in the kernel) are pure: no I/O, no `node:*`, no kit import at runtime other than the import-free cost entries below; `apps/cli` loads, redacts, and writes. An export (`export-atif`, `export-otlp`) is redacted like the server unless `ESTELA_REDACT=0`; the report rule above stays report-specific. Missing data is omitted, never zero; the one exception is ATIF's required `agent.version`, `"unknown"` when the log records none. The ATIF mapping pins ATIF v1.8 and the OTLP mapping pins the semconv schema version named by `OTLP_SEMCONV_VERSION` ([export formats](docs/reference/export-formats.md)); a semconv release updates that pin deliberately, and a mapping change updates that document in the same PR.
- MCP tools are registered by `registerAgentTools` (`packages/server/src/agent-tools/`) with `ctx.agent.registerTool` and an `inputSchema` generated from the strict `zod/mini` schema that parses the call; no RPC carries an `agent` field. Every tool result and error is redacted at the tool boundary whatever `ESTELA_REDACT` says, stays within 40,000 characters and says when it was cut, and shows a recorded id that is not safe to show as `@e<seq>` / `@l<n>`. The dev server's HTTP MCP route mounts only with `--mcp` (the one-time code does not gate it).
- RPC handlers take an opaque `traceId` and resolve it through the shell's resolver (the session catalog on the dev server; `current` is the launch session); paths never cross the wire as trace ids.
- Adapters fail loud on unknown generations. Do not silently drop events.
- Unknown data (log records, RPC inputs, stored rows, JSON files, caught errors) is parsed once at its boundary with a `zod/mini` schema; code past the boundary reads the parsed value. A walk over arbitrary JSON, where a schema per value costs too much, uses es-toolkit's `isPlainObject` and `isPrimitive`, and a primitive `typeof` test inside such a walk is fine. A shape check written by hand (an `asRecord`-style helper, a `typeof x === 'object'` test, an `as` cast on an unknown value) is allowed only as a brand-symbol guard, a deep-freeze helper, narrowing of a known union, or an object check for `WeakSet`/`WeakMap` bookkeeping, with that reason in a comment at the site.
- Event payloads are typed per kind (`TraceEvent` is the kit's `TranscriptEvent` union plus the view fields; `EventOf<K>`, `TraceEventPayloads`): read them by narrowing on `event.kind`, never through a helper or a cast. The trace schema checks JSON traces from outside the kit and the view once ([overview](docs/architecture/overview.md#event-payloads-and-parsing)). It has no defaults, `catch`, or transforms, and callers keep the checked value through a guard (`isTrace`, `assertTrace`), not the parse output. A kit upgrade that changes a payload type updates the schema in the same PR. `satisfies` in `packages/schema/src/types.ts` and `payloads.test.ts` catch a declared field that changes type and a new required field; a new optional kit field passes both (the loose payload objects keep it), so declare it in the schema before code reads it.
- In `apps/cli/src`, only `entry/` parses the command line (one route table, `entry/routes.ts`), writes to the terminal, opens the browser, and sets the exit code; `export/` and `packages/server` throw their own errors, and `entry/failure.ts` maps each expected failure to its message and exit code.
- Every entry point builds the server through `createEstelaServer` (`packages/server`); its definition's `setup` is the one place the RPC services are built and bound, so a DevFrame host that runs only `setup` gets the same server. An entry point may run the factory's steps (`openLaunch`, `catalog.start`, `open`) before setup to show progress; setup does not repeat them.
- Session reading (discovery, detection, parsing, summaries) is `@rivus/agent-kit`'s; `packages/server` imports it at runtime to read sessions, and `apps/cli` imports only `@rivus/agent-kit/redact` and `@rivus/agent-kit/node` at runtime (terminal lines and exports). Other packages may use its types with `import type` (`SessionSummary` comes from `@rivus/agent-kit/transcript`); do not copy kit types into a workspace package. One more exception: the kernel imports the kit's `/cost` (pricing math) and `/cost/prices` (the LiteLLM price snapshot) at runtime, because both import nothing, and the workspace and the `file://` report must price the same view trace in the browser; the web app reaches them only through the kernel. The root `vite.config.ts` lint rule enforces this (`scripts/check-layers.mjs` checks package dependencies only).
- Cost is the list price of recorded tokens (`priceTrace`), never an estimate: a request without input and output tokens, without a model, or with a model the snapshot does not price is unpriced with that reason, never $0; a sum names how many requests it leaves out; a request that records 0 tokens costs $0. Every cost shown or exported names the snapshot version.
- Names follow the kit wherever it models the same concept, and the type is the kit's (`import type`) wherever the shape matches too: a discovered session is a `SessionRef` (`ref` names nothing else), a session to read is a `SessionTarget` (`parseSessionTarget` turns a `path` or `path#sessionId` argument into one), `Trace.agents` is `Lane[]`, `Trace.capabilities` is `Capability[]`, an event's `kind` is a `TranscriptEventKind` and its `source` a `SourcePointer`, the reasoning kind is `reasoning` down to the CSS tokens, and a request's stop reason is its `finishReason`. A trace concept of another shape or meaning takes a name the kit does not use: `TraceSession` and `TracePromptSnapshotPayload` (the kit's `TranscriptSession` and `PromptSnapshotPayload` plus the fields a view trace adds), `TimelineLane` (the kernel's lane projection), `SkippedEntry` (one `Trace.skipped` entry by file and line, merged per file and reason in a view; the kit's `SkippedRecord` holds a source pointer), and the trace id (`traceId`, below). A local name for a kit concept stays only for a concrete cost, such as a collision or a wire or file format the kit does not share, and is listed here with that reason.
- The agent whose log is read is the `agent`, as in the kit: `SessionRef.agent`, `Trace.agent` (with `Trace.agentVersion`, as in the kit's `Transcript`), `SessionListRow.agent`, and the index's `agent` column. Do not call it `host`.
- The session index (`~/.cache/rivus-estela/index.sqlite`) is a cache: keyed by trace id, size, mtime, and a summary version; database session ids distinguish sessions sharing one path, and an OpenCode row's key is its own last write rather than the shared database stamp. A failed summary is never cached; `node:sqlite` is imported only in `packages/runtime-node`.
- Summary numbers are versioned by the kit's `SESSION_SUMMARY_VERSION`. The shell passes `INDEX_SUMMARY_VERSION = SESSION_SUMMARY_VERSION + HOST_ERA_OFFSET + INDEX_CONTENT_REVISION` to the index; rows at another version are recomputed. For changes to indexed session content, follow the `INDEX_CONTENT_REVISION` rule in [`packages/server/src/catalog/session-catalog.ts`](packages/server/src/catalog/session-catalog.ts).
- URLs carry opaque trace ids (a hash of agent and path, plus the session id for the `path#id` form), never paths.
- A change to a surface listed in [`docs/reference/public-interface.md`](docs/reference/public-interface.md) (commands, flags, exit codes, environment variables, MCP tool names and input schemas, the report file, the ATIF mapping; MCP result fields are documented in `docs/reference/mcp-tools.md` and covered from 1.0) updates that document, `docs/reference/`, and the user guide (`docs/guide/`) in the same PR, with a changeset of the matching bump.
- Names from before the rename (`agent-trace`, `AGENT_TRACE_*`) are not read anywhere; they stay only in the released `apps/cli/CHANGELOG.md` entries, `.changeset/ledger.yaml`, the `v0.1.0` tag, and links recorded before the rename.
- UI strings go through `apps/web/src/i18n/` (`dictionary.en.ts` is the type source, `dictionary.zh-CN.ts` satisfies it). Session content never does.

## Tooling

- pnpm workspace. Workspace settings and the shared external versions (`catalog:`) live in the root `pnpm-workspace.yaml`; Changesets versioning lives in `.changeset/config.json`.
- UI: Solid + Tailwind v4 + shadcn-solid (`@kobalte/core`). Not React shadcn.
- The toolchain is Vite+ (`vite-plus`, CLI `vp`). Each workspace package has one `vite.config.ts` for `vp test` and its build (`vp pack` in `apps/cli`, `vp build` in `apps/web`); `tsc` stays the type check. Test files import from `vite-plus/test`, not `vitest`. A `vite-plus` upgrade moves other pinned versions with it; rules in `CONTRIBUTING.md#pull-request-gates`.
- Put unit tests next to the code they test (for TypeScript, `foo.test.ts` beside `foo.ts`; other languages follow their own convention). Integration tests, which cross modules, run a built artifact, or go through an external boundary such as HTTP or a database, live in the package's `test/` directory, with shared fixtures under `test/fixtures/`.
- Lint and format settings live only in the `lint` and `fmt` blocks of the root `vite.config.ts`, built on `@perfectpan/lint-config/vite-plus`; a project's `vite.config.ts` has neither block, so `vp lint` and `vp fmt` find the root one.
- Lint is oxlint through `vp lint`: `pnpm -r lint` per package, and `node scripts/lint-scripts.mjs` for the root `scripts/` and `vite.config.ts`. `curly: all` is on: every `if`, `else`, `for`, `while`, and `do` body is a braced block.
- Format is oxfmt through `vp fmt` (`apps/cli` owns the vite-plus that the root scripts run) over JS and TS under `apps/`, `packages/`, and `scripts/`, and the root `vite.config.ts`. `node scripts/format.mjs` writes; `--check` verifies. Markdown, JSON, and fixtures are not formatted.
- A PR that changes shipped files under `apps/` or `packages/` carries a changeset under `.changeset/`; rules in `CONTRIBUTING.md#release-intent`. Do not edit generated changelogs or add a hand-written root `CHANGELOG.md`.
- Contribution workflow, Specs, and Plans live in `CONTRIBUTING.md`, `docs/specs/`, and `docs/plans/`. Do not copy the `technical-design-docs` skill into this repo.
- File and directory names are kebab-case, and a code file has at most 500 lines; rules in `CONTRIBUTING.md#file-conventions`.
- Every Spec and Plan ships with a `.zh-CN.md` reading copy in the same PR; rules in `CONTRIBUTING.md#bilingual-specs-and-plans`.
- The root README ships with a `README.zh-CN.md` reading copy in the same PR; other READMEs and templates have none. Rules in `CONTRIBUTING.md#bilingual-readme`.
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
pnpm install
gh repo-checks release-plan
node scripts/format.mjs --check
node scripts/lint-scripts.mjs
pnpm lint
pnpm test
pnpm typecheck
pnpm build
node scripts/check-layers.mjs
node scripts/check-browser-bundle.mjs
node scripts/check-budgets.mjs
cd apps/cli && pnpm run dev --no-auth
cd apps/e2e && pnpm run test:smoke
cd apps/e2e && pnpm run test:e2e
```

`check-budgets.mjs` runs the built CLI after `pnpm build` and checks time to first rows, a large session's load and peak RSS, and the bundle and tarball sizes against `scripts/budgets/budgets.mjs`; a change that outgrows a size budget raises it there with the new number and reason. `test:smoke` and `test:e2e` build `@rivus/estela`, pack `apps/cli`, and install the tarball; neither is part of `pnpm test`. `test:e2e` needs `npx playwright install chromium` once (or `ESTELA_E2E_CHANNEL=chrome`). Release to npm only through the Publish workflow; local checks use `changeset status`, `changeset publish-plan`, and `pnpm pack` (see `CONTRIBUTING.md#publishing-to-npm`).
