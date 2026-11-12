# Plan 0006: Move the server composition out of the CLI's commands

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-13
- Paired Spec: none (a technical refactor with no change in behavior; issue #108)

This plan moves the wiring of the Estela server (session reading through the kit, the session
catalog, the TraceStore, the report writer) from the CLI's `dev`, `build`, and `mcp` commands into
one factory in a new workspace package, whose DevFrame definition builds and binds the services in
`setup`. The CLI keeps the command line, terminal output, exit codes, failure mapping, and browser
opening.

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Verification
5. Execution plan
6. Risks, open questions, and follow-up

## 1. Background and goals

### 1.1 Current behavior and constraints

- `apps/cli/src/entry/commands/dev.ts` creates the Node platform, the `SessionCatalog`, and the
  TraceStore, then calls `bindTraceStore`, `bindSessionService`, and `bindReportExporter` from
  `@rivus/estela-rpc` before it loads the launch session, indexes, runs `--pick`, and calls
  `createDevServer`. `mcp.ts` and `build.ts` each create and bind their own TraceStore.
- The DevFrame definition (`apps/cli/src/server/devframe.ts`) is a module-level constant. Its
  `setup` registers the RPC functions and the session signal; it builds no service. The report
  writer imports that constant for `createBuild`.
- DevFrame runs `setup` in every adapter: `createDevServer` and `createMcpServer` in `dev` mode,
  `createBuild` in `build` mode, and `createEmbedded` (a hub) with the host's context. A hub runs
  only `setup`; it never runs a command.
- `apps/cli` is the only runtime importer of `@rivus/agent-kit`; `AGENTS.md`, the oxlint override
  in the root `vite.config.ts`, and `scripts/check-layers.mjs` say so.
- The RPC bindings in `@rivus/estela-rpc` are module state: one process serves one server.

### 1.2 Problem

A second entry point cannot reuse the wiring. A DevFrame hub or a harness plugin (the planned
`apps/dsh-plugin`, a cordis plugin inside DeepSeek Harness) has no command line and runs only
`setup`, which today binds nothing, so every RPC would fail with "trace store is not bound".

### 1.3 Goals and success criteria

- One factory, given the platform, the launch session, the redaction flag, the catalog with the
  index on or off, and a log sink, returns the DevFrame definition whose `setup` builds and binds
  the services, plus the handle the CLI needs.
- `dev`, `build`, and `mcp` call the factory; no command binds an RPC service itself.
- A test starts the server from the factory and DevFrame's dev adapter alone, with no CLI code,
  and reads a fixture session through RPC over the WebSocket.
- No change in behavior: every existing unit, CLI, smoke, and browser test passes unchanged in
  what it asserts.

### 1.4 Non-goals

- No plugin code, no hub code, no new MCP tools, no new RPC.
- No change to the RPC module state (one server per process stays).
- A public programmatic export of `@rivus/estela` is deferred (decision D3).

## 2. Outline

### 2.1 Design principles

- The definition's `setup` is the one place the services are bound, so a host that runs only
  `setup` gets the same server as the CLI.
- Steps the CLI shows progress for (launch load, catalog start, picker load) run once; the CLI may
  run them before the server listens and `setup` finds them done.
- Modules throw their own errors; only `apps/cli/src/entry/` maps them to messages and exit codes.
- No abstraction beyond what a second caller needs.

### 2.2 Boundaries and responsibilities

| Directory | Owns after this change |
|---|---|
| `packages/server` (`@rivus/estela-server`, private, bundled) | `createEstelaServer` and the DevFrame definition (`src/composition/`), session reading through the kit (`src/sessions/`), the session catalog (`src/catalog/`), the TraceStore over Node reads (`src/store/`), the report writer (`src/report/`), the S12 test support (`src/testsupport/`) |
| `apps/cli` (`@rivus/estela`) | command routes, terminal output, exit codes, the failure map, browser opening (`src/entry/open-browser.ts`), the ATIF and OTLP exports (`src/export/`), the package identity and web build handed to the factory (`src/server.ts`), the `vp pack` bundle |

### 2.3 Main path

```text
before: entry/commands/dev.ts
  -> platform, SessionCatalog, createTraceStore, bind* (rpc module state)
  -> load launch, index, pick
  -> createDevServer(devframe constant)   setup: register functions only

after:  entry/commands/dev.ts
  -> createEstelaServer(options)          (apps/cli/src/server.ts adds app identity)
  -> server.openLaunch(), catalog.start(progress), server.open(picked)   (shown in the terminal)
  -> createDevServer(server.definition)   setup: openLaunch (done), catalog.start (done),
                                                 bind* , resume summaries, session signal

hub:    createEmbedded(server.definition) setup: the same steps, run for the first time
```

### 2.4 Design decisions

| ID | Decision | Alternatives and reason |
|---|---|---|
| D1 | A new workspace package `packages/server` (`@rivus/estela-server`). | A programmatic module inside `apps/cli` keeps the composition next to the command line, but a future `apps/dsh-plugin` would then depend on the CLI package and its terminal code. The package is named by its responsibility (the server) and does not repeat its parent `packages/`. Its inner directory for the store is `store/`, not `server/`, so no directory repeats the package name. |
| D2 | `setup` runs each step through idempotent handle methods (`openLaunch` caches its promise; `catalog.start` already does) and binds the services; the CLI calls the same methods first. | Building every service inside `setup` would move the launch load, the index progress, and the picker after the server listens, which changes the terminal output and the failure order. Passing progress callbacks in the options is not needed: the CLI starts the catalog with its own callback, and the first `start` call's callback wins. |
| D3 | Defer the `exports` entry of `@rivus/estela` (no `@rivus/estela/server` in the tarball yet). `apps/cli/src/server.ts` is the function such an export would expose. | Measured: adding a `vp pack` entry for `src/server.ts` with `dts: { resolve: true }` fails. TypeScript 7 (`tsgo`) emits no declarations for workspace sources reached through the pnpm symlinks (`tsgo did not generate dts file for packages/server/src/index.ts`, also with `rootDir` and `paths` set), and the CLI-wide `tsconfig` fails on `entry/routes.ts` (TS2883, the router's inferred types). The declarations would also have to inline `@rivus/agent-kit` types, a devDependency that consumers do not install. A JavaScript export without types is not a usable API, and a public API is a semver commitment; the first consumer (`apps/dsh-plugin`) settles it. |
| D4 | Runtime kit imports: `packages/server` reads sessions through the kit; `apps/cli` imports only `@rivus/agent-kit/redact` (terminal lines, export files) and `@rivus/agent-kit/node` (the export command's platform). | Moving `export/` into the server package would make `apps/cli` kit-free at runtime but puts a command's writer in the server. The oxlint override enforces the two allowed CLI entries with a negated group pattern. |
| D5 | The catalog's summaries resume at the end of `setup`, not in `createDevServer`'s `onReady`. | A hub has no `onReady` for the caller. `createDevServer` listens before it runs `setup`, so summaries still start after the server listens; they start before the MCP route mounts and the Ready line prints, a few milliseconds earlier than before. Summaries are background work with no terminal output. |
| D6 | `build` no longer binds the TraceStore into the RPC module state. | `build` runs DevFrame only in `build` mode, where only `report-trace` is baked; the report reads the store directly (`reportOf`). The binding had no reader. |

## 3. Detailed design

### 3.1 Interfaces

```ts
// packages/server/src/composition/definition.ts
export const BASE_PATH = '/__estela/'
export interface EstelaApp {
  packageName: string
  version: string
  homepage: string
  description: string
  clientAssets: string // the built SPA directory, absolute
}

// packages/server/src/composition/estela-server.ts
export interface EstelaServerOptions {
  app: EstelaApp
  platform?: ShellPlatform // defaults to createNodePlatform()
  catalog: { index: boolean } | undefined // present on the dev server
  launch: SessionTarget | undefined
  redacts: boolean
  log?: (line: string) => void
}
export interface OpenedSession { traceId: string; trace: Trace }
export interface EstelaServer {
  definition: DevframeDefinition
  catalog: SessionCatalog | undefined
  store: TraceStore
  openLaunch: () => Promise<OpenedSession | undefined>
  open: (traceId: string) => Promise<OpenedSession>
  close: () => void
}
export function createEstelaServer(options: EstelaServerOptions): EstelaServer

// apps/cli/src/server.ts
export function createEstelaServer(options: Omit<EstelaServerOptions, 'app'>): EstelaServer
```

`packages/server/src/index.ts` also exports what the CLI uses from the moved modules:
`reportOf`, `writeReport(definition, outDir, report)`, `loadSession`, `errorMessage`,
`parseSessionTarget`, `sessionTargetLabel`, and the types `AgentProgress`, `SessionCatalog`,
`ShellPlatform`.

### 3.2 Setup and lifecycle

- `dev` mode: register `serverFunctions`; `await openLaunch()`; `bindTraceStore`; with a catalog,
  `await catalog.start()`, `bindSessionService`, `bindReportExporter` (writing with this
  definition), `catalog.resumeSummaries()`; then the `estela:sessions` shared state and
  `bindSessionPublisher`, as before.
- `build` mode: register `serverFunctions` and `reportFunctions` only, as before.
- Launch key: with a catalog, `catalog.openPath(target, trace)` (the list-row trace id); without,
  the `path#id` label, as before.
- `close()` flushes and closes the session index; the CLI does not call it today, as before.

### 3.3 Failures

- `openLaunch` and `open` throw the load's own error; `open` throws `no session has the trace id …`
  for an id the catalog does not resolve. The CLI wraps them in its `CliError` kinds `session`
  (`load`, `build`) and `index`, unchanged in wording and exit code.
- A failed launch load leaves `openLaunch` rejected; `setup` rethrows the same error to a host.

### 3.4 Compatibility

- The command line, terminal output, URLs, trace ids, RPC names and shapes, index file, report
  output, and the tarball's file list are unchanged.
- The one timing difference is D5.
- File moves: `apps/cli/src/{sessions,catalog,report,testsupport}/` → `packages/server/src/…`;
  `apps/cli/src/server/trace-store.ts` → `packages/server/src/store/trace-store.ts`;
  `apps/cli/src/server/devframe.ts` → `packages/server/src/composition/definition.ts`;
  `apps/cli/src/server/open-browser.ts` → `apps/cli/src/entry/open-browser.ts`; five integration
  tests from `apps/cli/test/` → `packages/server/test/`. The e2e harness and
  `docs/development/setup.md` run `large-session.ts` at its new path.

### 3.5 Security and privacy

Redaction is unchanged: the store redacts per `redacts`, the catalog per `ESTELA_REDACT`, reports
always. The factory test binds `127.0.0.1` with auth off.

## 4. Verification

- `packages/server/test/estela-server.test.ts`: `createEstelaServer` plus `createDevServer` on
  port 0, an empty temporary home, the Claude Code `plain` conformance fixture as the launch
  session; a WebSocket RPC client calls `load-trace` (cached), `get-trace-view`, and `get-event` on
  `current`, `get-trace-view` on the list-row trace id, and `list-sessions`.
- The moved unit and integration tests run in `packages/server`; the CLI's tests, `test:smoke`,
  and `test:e2e` cover the commands end to end on the packed tarball.

## 5. Execution plan

### 5.1 Preconditions

`main` at `055fccf` or later; Node `^26.13.1`.

### 5.2 Completion contract

- Every gate in 5.4 passes.
- No module under `apps/cli/src/entry/commands/` calls a `bind*` function from `@rivus/estela-rpc`.
- `AGENTS.md`, `CONTRIBUTING.md`, `docs/architecture/overview.md`, the oxlint override, and
  `scripts/check-layers.mjs` state the runtime kit rule of D4.

### 5.3 Execution order

#### Task 1: Create the package and move the modules

- Files: `packages/server/{package.json,tsconfig.json,vite.config.ts,src/index.ts}`, the moves in 3.4.
- Change: `git mv`; import paths; the report writer takes the definition as an argument.
- Tests: the moved tests, unchanged in what they assert.
- Exit condition: `pnpm typecheck` and `pnpm test` pass.

#### Task 2: Factory and commands

- Files: `packages/server/src/composition/*.ts`, `apps/cli/src/server.ts`,
  `apps/cli/src/entry/commands/{dev,build,mcp,export}.ts`.
- Change: 3.1 and 3.2; the commands call the factory.
- Tests: `packages/server/test/estela-server.test.ts`.
- Exit condition: the factory test, `test:smoke`, and `test:e2e` pass.

#### Task 3: Rules, documents, release intent

- Files: `AGENTS.md`, `CONTRIBUTING.md`, `docs/architecture/overview.md`, root `vite.config.ts`,
  `scripts/check-layers.mjs`, this plan and its Chinese copy, `docs/plans/README.md`,
  `.changeset/server-composition.md` (`none`: internal, no public export).
- Exit condition: `check-doc-translations`, `check-conventions`, `check-release-plan`,
  `check-layers`, and `pnpm lint` pass.

### 5.4 Validation ledger

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| all | `node scripts/check-doc-translations.mjs`, `node scripts/check-conventions.mjs`, `node scripts/check-release-plan.mjs` | ok |
| all | `pnpm install`, `node scripts/format.mjs --check`, `node scripts/lint-scripts.mjs`, `pnpm lint`, `pnpm typecheck` | no errors |
| all | `pnpm build`, then `pnpm test` | all pass |
| all | `node scripts/check-layers.mjs`, `node scripts/check-browser-bundle.mjs` | ok |
| all | `cd apps/e2e && pnpm run test:smoke`, `pnpm run test:e2e` | all pass |

### 5.5 Rollback per batch

One PR; revert it. No persisted data, index layout, or published interface changes.

## 6. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| RPC bindings are module state | risk | Two Estela servers in one process (a hub hosting two) would share one binding | unconfirmed | Revisit if a host needs two instances |
| Public `@rivus/estela/server` export (D3) | follow-up | `apps/dsh-plugin` cannot import the factory from the published package yet | unconfirmed | Settle the declaration build (isolated declarations or a hand-kept `.d.ts` over a narrow interface) with the plugin's first PR |
| Summary start moved into `setup` (D5) | risk | Summaries start a few milliseconds earlier on `dev` | unconfirmed | None unless startup regresses |
| Plans 0002 and 0003 name the old `apps/cli/src` paths | follow-up | Historical text only | unconfirmed | Updated when those plans are retired |
