# Plan 0010: Estela as a dsh plugin

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-24
- Paired Spec: [`docs/specs/0010-dsh-plugin.md`](../specs/0010-dsh-plugin.md)

This plan builds Spec 0010: a dsh plugin that shows the workspace of the current session inside `dsh web`. It has
three parts: a host core that exists once per instance and imports no DevFrame, the `<estela-workspace>` element
that `apps/web` builds from its workspace, and `apps/dsh-plugin`, the adapter that connects the two through dsh's
own RPC channel.

Two verifications were run for it, on dsh 0.2.2-rc.5: A1 rendered `apps/web` in a Shadow DOM and listed every
change it needs; A2 ran a third-party plugin's RPC channel and View inside `dsh web`. Their results are recorded in
two comments on issue #109 (the comments that start with "Verification A1" and "Verification A2"); this plan cites
them by name and section. What neither covered is listed in section 7, each with the batch that verifies it.

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

Estela, at `main` (`44cb909`):

- The workspace loads through `LoadClient` (`apps/web/src/workspace/load-session.ts:53-63`): `status`, `onStatus`,
  `loadTrace`, `traceView`, `event`, and `subscribe`. `createSessionLoad(traceId, connect)` takes the client factory
  (`load-session.ts:91`). A loaded session is `{ traceId, trace, summary, event(id) }` (`:14-21`). The loading panel
  shows "Loading…" when the file size is unknown (`workspace/load-screen.tsx:27`).
- `Workspace` reaches the DevFrame client outside that factory: `connectionLost()` opens it
  (`shell/connection.ts:9-29`), and "Export report" calls `scopedClient()` (`workspace/export-report.tsx:44-45`).
- The app reads and writes the page: routing reads `location.hash` and listens for `hashchange`
  (`shell/router.ts:19-27`); `bootLocation` rewrites the URL (`shell/boot.ts`); `session-browser.tsx:135` listens for
  `keydown` on `window`. The workspace looks nodes up through `document`: `workspace/workspace.tsx:45` and
  `workspace/inspector/inspector.tsx:80`.
- Theme tokens are on `:root` and `html[data-theme]` (`styles.css:44`, `:49-50`, `:99`); the page defaults for `html`
  and `body` are at `styles.css:138-150`. `initTheme` writes `document.documentElement.dataset` and reads `matchMedia`
  (`shell/theme.ts:7`, `:25-27`); `applyLocale` writes `<html lang>` (`i18n/locale.ts:46-49`). The switches are in
  `shell/top-bar.tsx:70-100`.
- The RPC bindings are module state: `packages/rpc/src/functions/service.ts:8`, `functions/trace-view.ts:68`
  (`:82-91`), `functions/report.ts:20-21`, and `publish.ts:5-6`. The report writer serializes on a module-level queue
  (`packages/server/src/report/report.ts:36-43`). `createEstelaServer` binds them in `setup`
  (`packages/server/src/composition/estela-server.ts:125-131`), so one process serves one Estela server (`:76`).
- `TraceStore` (`packages/rpc/src/trace-store.ts`) does not import DevFrame. It takes `resolve`, `load`, `fs`,
  `readOriginal`, `present`, and `log` (`:42-55`), and has `open(traceId, owner?)` (`:150`), `view` (`:183`), and
  `event` (`:199`). It keeps the last 3 traces (`:17`, `:382`). The file is 499 lines long, one below the limit.
- `createTraceStore` resolves `current` or the catalog and redacts through `present`
  (`packages/server/src/store/trace-store.ts:55`, `:76`). PR #172 gave `EstelaServerOptions` the `reportDir` option
  and made `redacts` the one switch for session text (`estela-server.ts:28-39`).
- `traceIdOf` hashes agent, path, and session id (`packages/server/src/sessions/session-target.ts:25-34`).
- `scripts/check-layers.mjs:19-34` needs an allow-list entry for every workspace package; `knip.ts` needs a
  workspace entry.
- `@rivus/estela` is the only published package (`CONTRIBUTING.md`, Release Intent). `publish.yml:35-42` passes one
  check command and one audit scope to the shared release workflow. `scripts/check-release-intent.mjs:16-17` names
  one document and one package.

dsh 0.2.2-rc.5, from the verifications and from its source at tag `dsh-v0.2.2-rc.5` (`9c2670d3`):

- A plugin is an npm package with `dsh.bundle.patch` pointing at a `cordis.patch.yml`. Browser UI is one classic
  script exported as `./client` and declared in `dsh.client`; it calls `window.__ModuleLoader__.load({ id, factory })`,
  and `factory(require)` returns `{ inject, apply }` (A2, section 4). dsh serves it as
  `/plugins/??<package>/client.js&rev=<rev>` on every page load, without a cookie.
- `ctx.connection.rpc.handle(channel, handler)` registers a channel. On rc.5 a plugin must list `webServer` in
  `inject` and call the `rpc` getter itself
  (`Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ctx.connection), 'rpc').get.call(ctx.connection).handle(...)`);
  the plain `ctx.connection.rpc.handle(...)` throws `cannot get property "webServer" without inject` and the plugin
  does not activate (A2, section 1.2). On 0.2.3-alpha.2 the plain call works (A2, section 8).
- The browser calls `ctx.connection.rpc.call(channel, endpoint, payload, signal?)`. `payload` is required. The result
  is `{ ok: true, value }` or `{ ok: false, error: { code, message, details } }`. There is no stream: `rpc.open` is
  `undefined` on the page (A2, sections 2.3 and 5). A handler that throws makes dsh answer 500 with the exception's
  message as it is (A2, section 5).
- A result of 11,931,777 bytes takes a median of 105 to 116 ms in the browser over five runs; the page's JavaScript
  heap rises about 35 MiB and dsh's RSS about 95 MiB for that call. The channel has no response size limit below
  V8's string limit (A2, section 2).
- The channel route calls dsh's admission and nothing else. No cookie is 401; another `Origin` or `Host` is 403. The
  browser cookie and the API cookie that `/connect?token=` issues both pass, and both carry the principal `owner`
  (A2, section 5).
- `ctx.sessionPersistence.stat(id)` returns a snapshot or `undefined`; its `location` (`{ kind, path }`) is absent for
  a session not written to disk (`packages/session/session-persistence/src/index.ts:51-68`).
- A third-party plugin registers a conversation View with
  `ctx.slots.inject('conversation.view', () => ctx.slots.register({ name, id, order, label, inject }, Component))`.
  With `dsh.client.inject: []` the tab appears after Trajectory, full width (A2, section 3).
- A blank session shows no View tabs: `DefaultConversationViews.tsx` returns `null` until `turn/start` (A2, section 3).
- Unloading a plugin removes its channel and its slot entries while `dsh web` runs: the tab is gone after about five
  seconds, the channel answers 405 like any unregistered path, and the profile no longer lists the package
  (A2, section 6).
- The client theme publishes `getSnapshot()` / `subscribe` with `active.colorScheme`
  (`ui-theme/src/client/index.ts:100-117`); the client locale publishes `getSnapshot().active`
  (`locale/src/client/index.ts:228-239`).
- `engines.dsh` is checked with `semver.satisfies(runtime, range, { includePrerelease: true })` at install
  (`plugin-manager/src/operations.ts:363-381`) and at profile start
  (`app-boot/src/compatibility-preflight.ts:79-83`, `:101-117`).

### 1.2 Problem

A dsh user who wants Estela's view of a session leaves the harness and runs a second command. Running it inside dsh
needs three things the repository does not have: a host core that can live inside another process, the workspace as
an element another page can mount, and a dsh package that ties them to dsh's session and connection.

### 1.3 Goals and success criteria

- DSH-1 to DSH-14 of Spec 0010 pass in the tests the Spec names.
- The `estela` command line behaves as before: same RPC names, inputs, and results; the CLI smoke and Playwright
  suites pass unchanged.
- All dsh-specific code is in `apps/dsh-plugin`.
- The plugin is a second published package, released by the Publish workflow.

### 1.4 Non-goals

- A public SDK: no `@rivus/estela/server` or `@rivus/estela/embed` entry is published (D3).
- A `/estela` command, a session browser inside dsh, live follow, a time view, "Export report" in dsh, the ATIF and
  OTLP exports from dsh, Dim, dsh Desktop, and the TUI profile.
- Changes to the kernel, the view budget, or the kit.

## 2. Outline

### 2.1 Design principles

- The plugin adds nothing that outlives it: no port, no process, no route, no file, no global.
- One workspace code path. The command line and the element render the same Solid components from the same view
  trace; the element differs in where its data, theme, and language come from.
- Unknown input is parsed once, where it enters: the channel handler parses each payload with a `zod/mini` schema,
  as the DevFrame handlers do (`packages/rpc/src/functions/parse-input.ts`).
- dsh's interfaces are used as they are and pinned by one smoke test, not abstracted for a second harness (D2).

### 2.2 Boundaries and responsibilities

| Directory | Owns after this change |
|---|---|
| `packages/rpc/src` | The RPC function definitions, built per server instance; the session publisher, per instance |
| `packages/server/src/core/` | `createEstelaCore`: the services of one Estela server without DevFrame and without the catalog (platform, TraceStore, redaction) |
| `packages/server/src/composition/` | `createEstelaServer`: the catalog, the core, and the DevFrame definition that binds the core's services |
| `apps/web/src/embed/` | The `<estela-workspace>` element, its `source` contract, and the document-level stylesheet |
| `apps/web/src/shell/` | The standalone app's shell: the router, the DevFrame client, the connection watcher, and "Export report"; it hands the shared workspace its loader and its connection state |
| `apps/dsh-plugin/src/host/` | The dsh host half: the plugin module, the `/estela` channel, dsh session id to log file |
| `apps/dsh-plugin/src/contract/` | The channel's endpoints, inputs, results, and error codes; the one file both halves import |
| `apps/dsh-plugin/src/client/` | The dsh client half: the conversation View, theme and language from dsh |
| `apps/dsh-plugin/scripts/`, `vite.config.ts` | The host bundle and the client bundle in dsh's factory format |

### 2.3 Main path

```text
dsh web page (React 18, dsh's own)
  conversation.view slot -> EstelaView (apps/dsh-plugin/src/client, React)
    |  ctx.connection.rpc.call('/estela', 'session/open', { sessionId })
    |     host: ctx.sessionPersistence.stat(sessionId) -> log path, size, mtime -> traceId
    |  ctx.connection.rpc.call('/estela', 'trace/view', { traceId })
    |  ctx.connection.rpc.call('/estela', 'trace/event', { traceId, id })  (when an event is selected)
    |     host: rpc.handle('/estela', handler) -> createEstelaCore -> TraceStore -> kit dsh reader
    v
  <estela-workspace source=... data-theme=... lang=...>   (Shadow DOM; Solid inside)
    the workspace: projections, reconstruct, diffContext, priceTrace run in the browser
```

### 2.4 Design decisions

Owner decisions, recorded from issue #109 (2026-11-24):

| ID | Decision | Reason |
|---|---|---|
| D1 | License GPL-3.0-only for the plugin and the code it bundles. | GPL obligations attach to conveying a work; nobody conveys the combination of plugin and dsh. dsh's MIT packages may be imported. |
| D2 | The plugin supports the dsh range its CI smoke test runs against; `engines.dsh` states that range. A dsh release that breaks the plugin gets a plugin release with a new range. | dsh is a release candidate whose extension points carry no compatibility promise. All dsh-specific code stays in `apps/dsh-plugin`, so a dsh change touches one package. |
| D3 | The embed SDK is not a public interface. The plugin bundles the host core and the element, and ships as a normal release with its own semver. Its public surface is the install command, the Estela View, and `engines.dsh`. | A public SDK frozen at 1.0 would have one consumer, and live follow (#104) will change the `source` shape. |

Decisions of this plan:

| ID | Decision | Alternatives and reason |
|---|---|---|
| T1 | Package name `@rivus/dsh-estela`. | Of 41 listed plugins whose root package name could be read (a sample of 45 entries in awesome-dsh-plugin), 36 are named `dsh-<name>`: 31 unscoped, 5 under the author's scope. The four session viewers the listing already has all carry that stem (`@240xu/dsh-session-lazy-view`, `dsh-llm-capture`, `dsh-llm-inspector`, `dsh-context-console`), and none of the sample carries a `-plugin` suffix. The `@rivus` scope is the owner's, and the name was free on npm on 2026-11-24. |
| T2 | Directory `apps/dsh-plugin` with `src/host/`, `src/client/`, `src/contract/`, `scripts/`, `test/`, and `assets/`. | The two halves load in different runtimes and share only the contract. |
| T3 | Two build outputs. `dist/host.mjs` bundles `@rivus/estela-server/core` and every `@rivus/*` package it reaches, with the kit, `zod`, and `es-toolkit`, as the CLI bundles them (`apps/cli/vite.config.ts:10-11`). `dist/client.js` is one classic script in dsh's factory format. `dependencies` stays empty. | Runtime dependencies would install into dsh's hoisted profile, where they can collide with other plugins. The CLI already bundles everything but DevFrame. |
| T4 | RPC function definitions are built per server instance: `createServerFunctions(services)`, `createReportFunctions(services)`, and `createSessionPublisher()` replace the constants and the `bind*` functions. | A module-level `let` rewires the first server when a second one binds. A factory is the smallest change that keeps the definition objects, their names, and their handlers. |
| T5 | A second server in one process is allowed. Nothing is thrown. | With T4 no module state is left to conflict. The issue's prerequisite to throw applied to the singletons. Two servers share what two processes share: the environment and the session index file. |
| T6 | The DevFrame-free core is a package entry, `@rivus/estela-server/core` (`packages/server/src/core/estela-core.ts`), and a lint rule keeps `packages/server/src/core/**` free of `devframe` imports and of the catalog. | Tree-shaking `devframe` out of the barrel depends on the bundler. An entry makes the boundary structural. |
| T7 | One channel, `/estela`, with three unary endpoints (3.3.2). | dsh's typed Remotes need generated artifacts. A route per call adds surface for nothing. |
| T8 | A loaded log is identified by a trace id that hashes the log path with its size and modification time; `session/open` computes it afresh each time. The host keeps the 16 most recently issued ids with their file stamps, and before it reads a file again for an older id it checks the stamp: one that changed answers `estela/stale`, and the client opens the session again. | The TraceStore caches by key. Without the stamp, a page reload after the session grew would show the old snapshot until dsh restarts. dsh's own `revision` is an opaque token that may not be a key. The store also drops snapshots and reads the file again for a missing one, so without the check an old View could read a changed log under its old id. |
| T9 | Each `trace/view` call takes its own hold on a load and releases it when the call ends or its `signal` fires. No owner is passed. | Browser sockets share one owner Peer, so the owner that lets one browser connection supersede its own loads would let one tab cancel another's. |
| T10 | Loading shows an indeterminate indicator. There is no progress endpoint. One load may block dsh's event loop for at most about N ms; the smoke test measures N (3.9). | The page has no stream (A2, section 5). A 100 MB log loads in 0.5 to 0.9 s on a laptop and a 12 MB view crosses the channel in about 0.1 s, so a 200 ms poll would draw a few updates. Polling was not measured. The loading panel already has the state (`load-screen.tsx:27`). The load itself runs on dsh's event loop: the platform decompresses there (`packages/server/src/sessions/node-platform.ts:59`) and the kernel fits the view there (`packages/kernel/src/view.ts:273`). Moving that work to a worker is not designed in this plan. |
| T11 | The host half lists `webServer` in `inject` and calls the `rpc` getter itself (3.3.1). It registers no route of its own. `engines.dsh` starts at 0.2.2-rc.5. | On rc.5 the documented call does not activate the plugin (A2, section 1.2). A route registered by the plugin works on rc.5 and answers 400 on alpha.2 (A2, section 1.3). rc.1 to rc.4 were not run, so they are not declared (D2). |
| T12 | The handler checks the peer: a principal other than `owner` is refused. It never lets an exception reach dsh, and no message it writes holds a path. | The route relies on dsh's admission alone (A2, section 5), and a non-owner peer reaching it was not tested. dsh sends a thrown exception's message to the caller as it is, and an error outside the store can name a path. |
| T13 | The element takes its theme (`data-theme`), language (`lang`), and optional host design tokens (`--estela-host-*` custom properties) from the client half (`ctx.theme` and `ctx.locale`). The element draws no switches, no Estela top bar, and no duplicated session `h1`; it renders a single compact stats bar with a "Jump to" control (`⌘K` / `Ctrl+K`). | The user already chose theme, language, and session in dsh. Adopting dsh's live `--dsw-*` surface, border, text, accent, font-family, and radius tokens through `--estela-host-*` makes the View blend with dsh's Chat and Trajectory tabs without hardcoding hex colors or leaking foreign `:root` vars, while Estela keeps its own event-kind colors (`--kind-*`), font sizes, and fixed ledger row heights so virtualization and text measurement stay exact. |
| T14 | "Export report" is not offered in the first version. The element draws the button only when a host provides it, and no host does. | A report needs the standalone web build and DevFrame's `createBuild` inside the dsh process, which is unverified and prints its build log with the absolute output path into dsh's terminal (`packages/server/src/report/report.ts:140-143`). It would roughly double the browser code the plugin ships. dsh offers no way to choose a directory, so the file would land where the user did not pick. The command line's `build` and "Export report" remain the way to get a report. |
| T15 | The plugin shows the current session only. There is no session browser inside dsh, and a blank session gets no entry point. | dsh's session list already leads to every started session in two clicks. A session browser needs the catalog and the session index inside dsh, a second screen in the element, and an entry point other than `conversation.view`, which no verification has run. |
| T16 | There is no `/estela` command in the first version. Decided by the owner on 2026-11-24. | On rc.5 a command cannot select a View: the selected View is the conversation store's `view`, which only slot components reach (`ui-conversation/src/client/skeleton/DefaultConversationViews.tsx:19-20`); neither `ctx.conversation` nor `ctx.uiConversation` selects one, and `binding.activate` only marks a target for assembly. The tab is one click away. A command that clicked dsh's tab in the DOM would depend on markup dsh does not promise. Adding a command later is an addition. |
| T17 | The client half is a React 18 component with no JSX. It owns the `<estela-workspace>` element and sets `source` and the attributes through a ref; Solid runs only in the element's shadow root. `react` comes from the factory's `require`. | dsh's shell is React 18 and its slot system renders React components. Solid and React never share a tree: React owns the host element's attributes and properties, Solid its shadow root. `createElement` keeps two JSX runtimes out of one bundle. |
| T18 | The embed code is part of `client.js`. There is no second file. | dsh's loader for a plugin's extra files and chunk loading were not verified (A2, section 9). One script is the only delivery that ran. It costs at most about 122 kB gzip on each dsh page load, the size of today's web bundle, which the embed narrows and does not widen; the budget of T24 watches it. |
| T19 | Document-level rules go into one `<style>` element that holds only the `@property` rules, added when the first element connects and removed when the last disconnects. The embed injects no `@font-face`: inside dsh it adopts `--dsw-font-family` and `--ds-font-family-code` via `--estela-host-font-sans` / `--estela-host-font-mono`, and falls back to the system stacks when those host variables are absent. Decided by the owner on 2026-11-24; lightweight host-token adoption added on 2026-11-25. | `<style>` and `CSS.registerProperty` rendered identically (A1, section 2.2), and the build already produces the rules as text. A search of the source of dsh's web server, web client, and connection packages at that tag finds no `Content-Security-Policy` header. Without webfonts the bundle is about 120 kB gzip smaller on every dsh page load, and the plugin adds nothing to the host page's font namespace. Adopting dsh's font stacks aligns typography with Chat and Trajectory while keeping Estela's own font sizes and fixed ledger row heights. |
| T20 | `engines`: `{ "dsh": ">=0.2.2-rc.5 <0.3.0-0", "node": ">=24.9.0" }`. No `peerDependencies`. | The lower bound is the version the smoke test runs (D2). The upper bound excludes the next minor; on 0.2.3-alpha.2 the channel, the View, and the bundle format still worked (A2, section 8). The Node range is dsh's own on rc.5, so it is never the reason for a refusal. The plugin imports no `@deepseek-ai/*` package at runtime, so there is no instance to share and no peer range to conflict with a prerelease. |
| T21 | The smoke test is `apps/dsh-plugin/test/dsh.smoke.ts`, run by its own CI job, `dsh-plugin`, on Linux, with a pinned dsh installed into a temporary prefix. A weekly run and a manual run use dsh's `latest` tag. | dsh is 1.3 GB installed; as a workspace devDependency it would enter every install. The `latest` run is the signal D2 needs. |
| T22 | The plugin may depend on `@rivus/estela-server` (its `core` entry) and on `@rivus/estela-web` (its `embed` entry, at build time), and may use the types of `@rivus/agent-kit`, `@rivus/estela-rpc`, and `@rivus/estela-schema`. | It reads sessions through the core and ships the element; it imports nothing else at runtime. |
| T23 | Release: no change to `.changeset/config.json`. The package stays `private: true` until batch 10, which makes it public in the same pull request as the npm bootstrap, the release checks, the interface documents, and the first changeset. `publish.yml` builds the plugin too and audits both scopes. The plugin's covered surface gets one section in `docs/reference/public-interface.md`, and `check-release-intent.mjs` attributes a change to a package by its section. The plugin has its own version, not a `fixed` group. | Changesets versions and publishes every public package: one that is public before it can be released stops a CLI release at `first-publish`, and no changeset may name a private package. The plugin's semver is its own (D3). |
| T24 | `scripts/budgets/budgets.mjs` gets four size budgets: `client.js` raw and gzip (at most about 122 kB gzip, since the embed ships no webfonts), `dist/host.mjs`, and the plugin tarball. The load stall of T10 is a limit in the smoke test, not a budget row. | dsh loads every installed client bundle on each page load (T18). |
| T25 | The client half wraps the element in a `div` whose height it sets in pixels from the size of dsh's scrolling area. **Not verified; batch 7 verifies it first.** | dsh sizes a View by its content inside a scrolling area (`ui-conversation/src/client/skeleton/ConversationRoot.module.css`, `.viewArea`: `flex: 1 0 auto; min-height: auto` in the active phase), and the workspace needs a definite height for its virtualized ledger. A1 measured the element in a host that gave it the full height. |

## 3. Detailed design

### 3.1 Host core per instance

#### 3.1.1 RPC services per instance (`packages/rpc`)

- `functions/service.ts`, `functions/trace-view.ts`, `functions/report.ts`, and `functions/list-sessions.ts` keep
  their definition objects and handlers. Each module's `let` and its `bind*` / `require*` functions go away. The
  definitions are built by functions that close over a services object.
- `index.ts` exports:

```ts
export interface ServerServices {
  store: TraceStore
  listSessions?: (input: ListSessionsQuery) => Promise<ListSessionsResult>
  exportReport?: (input: ExportReportInput) => Promise<ExportReportResult>
  /** The one report a build bakes; `writeReport` sets it right before DevFrame builds. */
  reportSource: ReportSource
}
export function createServerFunctions(services: ServerServices): ServerFunctions
export function createReportFunctions(services: Pick<ServerServices, 'reportSource'>): ReportFunctions
export function createSessionPublisher(): SessionPublisher   // { bind(publish), emit(signal) }
export function createReportSource(): ReportSource           // { set(next: () => Promise<ReportTrace>) }
```

- `ServerFunctions` and `ReportFunctions` are the tuple types of what the factories return. The DevFrame module
  augmentation (`index.ts:52-55`) uses them in place of `typeof serverFunctions` and `typeof reportFunctions`, so the
  names `apps/web` calls (`load-trace`, `get-trace-view`, `get-event`, `reconstruct`, `export-report`,
  `list-sessions`) stay typed.
- A definition that finds its service absent throws the message it throws today: `'session service is not bound'`
  becomes `'list-sessions is not available'` for a server without a catalog, which `listSessions` already checks
  (`functions/list-sessions.ts:35`); `'trace store is not bound'` and `'export-report is available only on the dev
  server'` cannot occur, because the services object is built with the server.
- `packages/server/src/catalog/session-catalog.ts:6`, `:358` call `emitSessions` from the module. `CatalogOptions` gets
  `announce?: (signal: SessionsSignal) => void`, and `createEstelaServer` passes the publisher's `emit`.
- `packages/server/src/report/report.ts`: the module-level `queue` (`:36-43`) becomes a queue that `createEstelaServer`
  creates and passes to `writeReport`, `exportReport`, and `buildSite`. `buildSite` (`:140-143`) calls
  `reportSource.set(...)` on the instance's source instead of `bindReportSource`.
- `composition/definition.ts:31-79`: `defineEstela(app, functions, report, services)` registers the functions it is
  given and binds the publisher it is given.
- `composition/estela-server.ts:78-145`: `createEstelaServer` builds the services object, the function tuples, and
  the definition with them. `setup` keeps its order (launch load, catalog start, agent tools, shared state), and
  `EstelaServer` gains `writeReport(outDir, report)`, which `apps/cli/src/entry/commands/build.ts:41` calls in place
  of the free function. The free `writeReport` and `exportReport` stop being exported from `packages/server`.

The command line keeps its behavior because the wire surface does not change: the same definitions with the same
names, input schemas, and handlers are registered once per server, and the CLI creates one server per process.

#### 3.1.2 The DevFrame-free core (`packages/server/src/core/`)

- `core/estela-core.ts` holds `createEstelaCore(options): EstelaCore` with these options:

```ts
export interface EstelaCoreOptions {
  /** Reads, the home directory, and the environment. Defaults to `createShellPlatform()`. */
  platform?: ShellPlatform
  /** Redact the session text the core returns. */
  redacts: boolean
  /** Resolves trace ids: the session catalog on the dev server; a host's own ids, as the plugin's. */
  resolve?: (traceId: string) => ResolvedSession | undefined
  /** Where the TraceStore's warnings go, one line each, redacted like the store; omit to drop them. */
  log?: (line: string) => void
}
```

- The core creates the platform and the TraceStore and returns `store`, `seed(session, trace)`, and `redact`, a text redactor that follows `redacts`. It imports neither DevFrame nor `SessionCatalog`: the catalog reaches `node:sqlite` through the session index (`packages/server/src/catalog/session-catalog.ts:6`), and the plugin's host bundle must not. The lint rule of T6 also keeps `packages/server/src/core/**` free of imports from `packages/server/src/catalog/`.
- `createEstelaServer` builds the catalog where it does today (`estela-server.ts:81-88`) and hands the core `resolve: traceId => catalog.resolve(traceId)`. `openLaunch`, `open`, and `close` stay in the composition, so the catalog's start, summaries, and close stay where they are, and `EstelaServer` keeps every member it has.
- The core re-exports `traceIdOf` for hosts that make their own keys. `packages/server/package.json` gets `"./core": "./src/core/estela-core.ts"`. Because `@rivus/estela-rpc`'s root barrel imports `devframe` and calls `createDefineWrapperWithContext()` from `devframe/rpc` at top level (which the bundler cannot tree-shake out), `packages/rpc/package.json` also exports `"./trace-store": "./src/trace-store.ts"` (holding `TraceStore`, `CURRENT_TRACE_ID`, and `SnapshotChangedError`), `packages/server/src/store/trace-store.ts` and `core/` import from `@rivus/estela-rpc/trace-store`, and the lint rule covers both `core/**` and `store/**` and forbids the root `@rivus/estela-rpc` entry there. `ResolvedSession` carries an optional `expect?: FileStamp` (`{ size, mtimeMs }`); when set, `TraceStore` checks `target.path` after `entryOf` and before `remember` and throws `SnapshotChangedError` without caching on a mismatch, leaving callers without `expect` (the dev server and catalog) unchanged.
- `sessions/redaction.ts:2` imports `homeDir` from the `@rivus/estela-runtime-node` barrel, which also exports the session index. The check on the built bundle (3.5.2) is what shows that the bundler dropped the index. If it did not, `homeDir` gets its own entry in `packages/runtime-node`.

### 3.2 The embed element (`apps/web`)

#### 3.2.1 The element and its `source` contract

- `apps/web/src/embed/index.ts` exports `defineEstelaWorkspace()`, which defines `<estela-workspace>` when it is not
  defined yet. `apps/web/package.json` gets `"./embed": "./src/embed/index.ts"`.
- `apps/web/src/embed/estela-workspace.ts` is the element. It attaches an open shadow root, adds the shadow part of
  the stylesheet, and renders the `Workspace` into it through Solid. On disconnect it disposes the render and its
  listeners. `data-theme` (`light` or `dark`) and `lang` (`en` or `zh-CN`) are observed attributes.
- `source` is a property, because React 18 sets object props on custom elements as attributes. Setting it mounts the
  session; the element asks it again on every retry:

```ts
export interface WorkspaceSource {
  /** Opens the session and resolves when its log is read and the view is built. Called again on every retry. */
  open(): Promise<TraceViewResult>
  /** One event in full, of the view identified by `traceId` (the id returned by `open`). */
  event(traceId: string, id: string): Promise<EventDetail>
}
/** `open` rejects with it when the session has not written a log yet. */
export class NoLogError extends Error {}
/** `event` rejects with it when the log changed since the view was built; the element then calls `open` again. */
export class StaleError extends Error {}
```

- `apps/web/src/embed/load-client.ts` adapts a `WorkspaceSource` to the `LoadClient` that `createSessionLoad` takes,
  so that flow is unchanged: `loadTrace` resolves at once with a file size of 0 (the panel shows "Loading…"),
  `subscribe` returns an empty iterable, `traceView` calls `open` and takes the trace id from its result, and `event`
  calls `event(traceId, id)` with the current view's trace id.
- `NoLogError` becomes a `LoadFailure` with `noLog: true` (`load-session.ts:24-31`), and `ErrorPanel` then shows
  "This session has no log on disk yet." and nothing else.
- "Try again" and a `StaleError` from `event` both run the load again, which calls `open`. So a source whose `open`
  calls `session/open` each time (3.4.1) retries the session, not the refused load. A test has `open` refuse once
  and then resolve: the workspace renders, and the element and its `source` are not replaced.
- The load path inside the element (loading, ready, the error states) was not run by A1, which used report mode.
  Batches 4 and 5 cover it.

#### 3.2.2 Changes in `apps/web`

Each row is one change A1 named. "Measured" means A1 has pixel or probe data for it; "read" means A1 read the code
and did not run that path.

| # | Where | Change | Evidence | Batch |
|---|---|---|---|---|
| A1 | `styles.css:4-8` (the fontsource imports) | Not done in the embed: it injects no `@font-face` and uses the fallback families (T19). Chrome does not apply `@font-face` inside a shadow root, so the text is drawn in the fallback fonts. | Measured (`none`) | 4 |
| A2 | The `@property` rules Tailwind generates | The same for them. Without them `box-shadow` and the border width of utilities lose their initial values. | Measured | 4 |
| A3 | `styles.css:44`, `:49-50`, `:99` | The token selectors also match `:host` and `:host([data-theme="…"])`; `color-scheme` is in the same block. Same-named tokens of the host page stay out, while `:host` opts into host surfaces, text, borders, accent, radius, and font stacks via explicit `--estela-host-*` vars (leaving `:root` / `html[data-theme]` untouched for CLI 0-pixel invariance). | Measured | 3 |
| A4 | `shell/theme.ts:21-28` | `apply()` writes `data-theme` to the element as well. | Measured | 3 |
| A5 | `i18n/locale.ts:46-49` | `applyLocale()` writes `lang` to the element as well, so `:lang()` inside does not follow the host page. | Measured | 3 |
| A6 | `main.tsx:14` | The embed entry takes the element's shadow root as its mount node. | Measured | 4 |
| A7 | `shell/router.ts:19-27`, `shell/boot.ts` | Unchanged. The embed entry imports neither. | Read | 5 |
| A8 | `shell/router.ts:21`, `browser/session-browser.tsx:135` | Unchanged. The embed entry imports neither. | Read | 5 |
| A9 | `workspace/workspace.tsx:44` | The element draws no "Export report" button. | Class checked | 3 |
| B1 | `styles.css:138-150` | `:host` declares `display: block`, `height: 100%`, `margin: 0`, the background and foreground colors, the font family, `font-size: 13px`, `line-height: normal`, and antialiased smoothing. | Measured | 3 |
| B2 | `styles.css` (`:host`) | `all: initial` comes first, then `tab-size: 4` and `-webkit-text-size-adjust: 100%`. | Measured | 3 |
| B3 | `workspace/timeline/timeline.tsx:17` | The label font is the element's computed font, not `document.body`'s. | Measured | 3 |
| B4 | `workspace/workspace.tsx:45` | "Jump to" queries the workspace root, not `document`. | Measured | 3 |
| B5 | `workspace/inspector/inspector.tsx:80` | The arrow keys focus the next tab found in the tab list, not through `document.getElementById`. | Measured | 3 |
| B6 | `shell/theme.ts:27` | `root.dataset.kbTheme` is removed; nothing reads it. | Measured | 3 |
| B7 | `workspace/export-report.tsx:73` | Unchanged. The component is not in the embed entry. | Read | — |
| B8 | `shell/connection-lost.tsx:19`, `browser/session-browser.tsx:211`, `workspace/workspace.tsx`, `workspace/session-header.tsx`, `workspace/error-panel.tsx:47` | The element has no `location.reload()`, no `#/` link, no Estela `TopBar`, and no duplicated session `h1`: in `embedded` mode `Workspace` omits `TopBar`, frames its bottom edge cleanly above dsh's composer (`border-b border-border`), wires `⌘K` / `Ctrl+K` (ignoring editable host inputs), and `SessionHeader` draws one compact stats strip with a "Jump to" button; `ErrorPanel` drops back links and reloads; the other two files are not in the embed entry. | Read + smoke | 3, 5 |
| B9 | `shell/report.ts:62` | Unchanged. Report mode is not in the embed entry. | Read | — |
| B10 | The embed entry | One `<style>` element at document level, holding the `@property` rules (T19). | Measured, both ways | 4 |

The rows marked "read" get a check in batch 5: the element is mounted in a host page, put through "Jump to", the
tab keys, "Try again", and a failed load, and the host page's `location.href` is the same before and after.

#### 3.2.3 The stylesheet

- `apps/web/vite.config.ts`, in the embed mode only, resolves the five fontsource imports (`styles.css:4-8`) to empty
  modules, so the embed style sheet holds no `@font-face` and no font file. The command line build keeps them.
- `apps/web/src/embed/stylesheet.ts` splits the stylesheet by top-level rule into the `@property` rules for the
  document and the rest for the shadow root. A1's harness split it the same way and counted the `@property` rules at
  60 with none cut. A test makes the same count on the built style sheet and checks that the two parts joined equal
  the input.
- The document part is one `<style data-estela-shared>` per document, kept while at least one element is connected.

#### 3.2.4 The embed build

- `apps/web/vite.config.ts` takes a mode: `vp build` is the app as today; `vp build --mode embed` builds the element
  into `apps/web/dist-embed/` with its style sheet as a string and without fonts. `apps/web`'s `build`
  script runs both. `.gitignore` gains `dist-embed/`, so the CLI's copy of `apps/web/dist`
  (`apps/cli/vite.config.ts:18`) and the tarball file list (`apps/e2e/src/cli.smoke.ts:75-93`) are unchanged.
- The embed entry imports neither `devframe/client`, nor the session browser, nor the router, nor report mode. A
  test on the built file asserts that `devframe` is absent.
- `dist-embed/` is a test artifact: it feeds `apps/e2e/src/e2e/embed.e2e.ts`, the harness page A1 used. The plugin
  bundles the same entry from source (3.5.2).

#### 3.2.5 The shell split

- Today `Workspace` reaches the DevFrame client on its own: `connectionLost()` for the banner
  (`workspace/workspace.tsx:56`) and the default `connect` of `createSessionLoad` (`load-session.ts:65-78`, which opens
  `devframeClient`). The shared workspace stops doing both. `Workspace` takes three more props: `connect`, the loader
  (`createSessionLoad` loses its default); `lost`, an accessor to the connection state, absent when the host has none;
  and `export`, the element drawn in place of "Export report", absent when the host offers none.
- `apps/web/src/shell/app-shell.tsx` is the standalone shell. It builds `connect` from `devframeClient` and
  `scopedClient` (the `defaultClient` of `load-session.ts` moves there), and passes `lost = connectionLost` and the
  `<ExportReport>` element. `app.tsx` renders it in place of `<Workspace>`. The session browser keeps its own
  `connectionLost()`.
- The element passes the adapter of 3.2.1 and neither of the other two props (batch 4).
- Tests, in `apps/web/src/workspace/workspace.test.tsx`: `Workspace` with a fake `connect` renders the ready view;
  when `lost` turns true the banner shows; without `lost` it never does; without `export` there is no button. The
  built-file test of 3.2.4 (`devframe` absent from `dist-embed/`) is the proof that the shared workspace does not
  reach the DevFrame client.

### 3.3 The dsh adapter: host half

#### 3.3.1 The plugin module

- `src/host/index.ts` exports `name`, `inject`, and `apply(ctx)`. `inject` is
  `['connection', 'webServer', 'sessionPersistence']`: `webServer` because `rpc.handle` registers its route through
  it in the caller's scope, `sessionPersistence` for the session's log path.
- `apply` creates the core with `redacts` false only when the core's platform environment has `ESTELA_REDACT=0`, and
  with its own `resolve`. It registers the channel inside `ctx.effect`. The disposer releases every open hold and
  clears the issued ids.
- Nothing starts at load. A log is read only when the browser asks for it.
- `src/host/rpc.ts` is the one place that reaches `rpc`:

```ts
const connection = ctx.connection
const rpc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(connection), 'rpc')?.get?.call(connection)
  ?? connection.rpc
```

  The getter call is what works on rc.5 and also works on alpha.2 (A2, sections 1.2 and 8). If a later dsh makes
  `rpc` a plain property, the fallback is the documented call. The smoke test pins both the range and this call.

#### 3.3.2 The channel

`src/contract/channel.ts` holds, for both halves, the endpoint names, the TypeScript types of inputs and results,
the error codes, and the `zod/mini` schemas of the inputs.

| Endpoint | Input | Result | Refusal |
|---|---|---|---|
| `session/open` | `{ sessionId }` | `{ traceId }` | `estela/unknown-session`: dsh has no stored session with that id. `estela/no-log`: the session has no file on disk. `estela/failed`: the file cannot be stat'ed, or dsh refuses the session's format (3.3.3). |
| `trace/view` | `{ traceId }` | `TraceViewResult` | `estela/unknown-trace`. `estela/stale`: the log changed since the id was issued (3.3.3). `estela/failed`: the load failed; `message` is the store's, already redacted. |
| `trace/event` | `{ traceId, id }` | `EventDetail` | `estela/unknown-trace`. `estela/stale`. `estela/failed`. |

- Every endpoint also refuses with `estela/bad-request` when its input fails its schema, with `estela/forbidden`
  when the peer's principal is not `owner` (T12), and with `estela/closed` for a call that is still running when the
  plugin is disposed. A call made after the unload never reaches the handler: dsh answers 405 (A2, section 6).
  `details` is always `{}`.
- The handler wraps the dispatch in one `try` / `catch`: an exception becomes `estela/failed` with the fixed
  message `"the session could not be read"`. Messages that can hold a path come only from the store, which redacts
  them before they leave (`trace-store.ts`, `guard` and `scrub`). The message for a file that cannot be stat'ed is
  fixed too. The one message the plugin composes is the unknown-generation message of 3.3.3, redacted through
  `core.redact`.
- `sessionId`, `traceId`, and `id` are strings of 1 to 256 characters without control characters. dsh's session id
  grammar is not documented here, so the schema does not narrow it further.
- Results are not parsed again in the browser: both halves ship in one package and the host produced the value
  (`TraceViewResult`, `packages/rpc/src/trace-store.ts:62-69`; `EventDetail`, `:72`).
- The client maps codes to the element's states: `estela/no-log` to a `NoLogError`, `estela/stale` to a `StaleError`;
  every other refusal to a failed load with `message`, which `parseFailure` splits into agent, file, line, and reason
  (`load-session.ts:38-44`), so DSH-5 shows the unknown-format hint from the reason as today
  (`workspace/error-panel.tsx:45`).

#### 3.3.3 Session to log file to trace id (`src/host/sessions.ts`)

```text
session/open(sessionId)
  snapshot = ctx.sessionPersistence.stat(sessionId)
  undefined                           -> estela/unknown-session
  throws a format refusal             -> estela/failed, the unknown-generation message
  no location                         -> estela/no-log
  info = core.platform.fs.stat(location.path)
  undefined or an exception          -> estela/failed
  traceId = traceIdOf({ agent: 'dsh', path: location.path, sessionId: `${info.size}:${info.mtimeMs}` })
  issued.set(traceId, { key: traceId, target: { path: location.path }, stamp: info })   // `resolve` reads this map
  keep the 16 most recently issued ids
  -> { traceId }
```

- The trace id is opaque on the wire and changes when the file's size or modification time changes, so a later open
  reads the log again and an unchanged one comes from the cache (DSH-9). A file rewritten with the same size inside
  one timestamp granularity is not noticed.
- The host keeps the 16 most recently issued ids, more than the 3 snapshots the store caches. An older id is refused
  with `estela/unknown-trace`, which the client shows like any failed call. A key must not be dropped merely because
  the store does not cache it yet: a load still in flight needs it to resolve afterwards.
- Before `trace/view` or `trace/event` reads a file again for an id the store no longer caches, the host stats the
  file and compares it with the stamp. A different size or modification time answers `estela/stale`, drops the id,
  and reads nothing: the ledger on screen belongs to the old snapshot, and an event read from a changed log would
  not. The client then calls `session/open` again (3.4.1). A test evicts an id behind three other sessions, changes
  the file, and asks for an event.
- To make the `traceId ↔ stamp` mapping a store invariant across races (cold reloads, concurrent waiters, aborted
  reloads, and cache evictions between `open` and `view`), `resolve` attaches the issued file stamp as
  `ResolvedSession.expect`. `TraceStore` re-stats `target.path` after `entryOf` and before `remember`, refusing to
  cache the entry and throwing `SnapshotChangedError` whenever the stamp no longer matches; the host maps
  `SnapshotChangedError` to `estela/stale` and drops the id. On a cached `trace/event` whose original cannot be read
  back (`originalUnavailable`), the host also returns `estela/stale` and drops the id when the source file's stamp
  changed or the file no longer exists, while keeping `originalUnavailable` when the file is still unchanged.
- dsh's persistence can refuse a session whose format generation it does not read before Estela's reader sees the
  file: `stat` rejects with a `SessionFormatUnsupportedError` whose message already holds the reason and the path
  (`session-persistence/src/errors.ts:111-121`, `session-persistence-jsonl/src/index.ts:496`, `:1204`).
  `session/open` catches it, checks the error with a `zod/mini` schema on its `name`, and answers `estela/failed`
  with the message the kit would give: `dsh: <path>:1: unknown format generation: <reason>`, the path and the reason
  passed through `core.redact`. So DSH-5 shows the format reason and the issue link on this real path too. A test
  sends such an error through a fake `ctx.sessionPersistence` and asserts the message and the redaction.
- `location.kind` is not checked: the kit's reader detects the format from the file and fails loud on one it does
  not know.

#### 3.3.4 Loads and holds

- `trace/view` takes a hold with `core.store.open(traceId)` and no owner, waits for `handle.done`, and releases the
  hold in a `finally`. When the call's `signal` fires first, the hold is released at once; the last holder's release
  aborts the load (`TraceStore.hold`, `trace-store.ts:395`). It then returns `core.store.view(traceId)`.
- `trace/event` calls `core.store.event(traceId, id)`. It uses the cached entry or takes a hold of its own
  (`TraceStore.entryFor`, `trace-store.ts:323`).

#### 3.3.5 Redaction

The core redacts through `present` (`packages/server/src/store/trace-store.ts:76`), which covers the view trace, the
events, and the store's error messages, and offers the same redaction as `core.redact` for the one message the plugin
composes (3.3.3). The plugin returns nothing else that holds session content, and its other messages are fixed
strings (T12). `ESTELA_REDACT=0` in dsh's environment turns redaction off, as for the dev server.

### 3.4 The dsh adapter: client half

#### 3.4.1 The conversation View

- `src/client/index.ts` is the factory's body. `inject` is `['slots', 'connection', 'theme', 'locale']`, and
  `dsh.client.inject` lists `@deepseek-ai/dsh-client-ui-theme` and `@deepseek-ai/dsh-client-locale`; `slots` and
  `connection` are rows of the shell itself. `apply` calls `defineEstelaWorkspace()` and registers the slot entry
  inside `ctx.effect`, as dsh's Statistics plugin does.
- The slot entry is `{ name: 'conversation.view', id: 'estela', order: 60, label: 'Estela', inject: sessionId =>
  ({ sessionId }) }`. With `order: 60` the tab follows Trajectory (A2, section 3).
- Its component (`src/client/estela-view.ts`, no JSX per T17; context types in `src/client/types.ts`) renders a wrapper
  `div` and, inside it, `<estela-workspace>` through a ref, and sets `source` (`src/client/source.ts`) once per
  `sessionId`. That source's `open` calls `session/open` for the current `sessionId` on every call and then `trace/view`
  with the id it returned; a refusal rejects with the mapped error. `event` calls `trace/event` with the trace id the
  element passes. So "Try again" and a stale snapshot both open the session again without remounting the View (3.2.1).
- The wrapper's height (T25, `src/client/view-height.ts`): measured on dsh 0.2.2-rc.5 in batch 7, dsh's View area
  (`flex: 1 0 auto` inside an `overflow-y: auto` scroll body) does not constrain the element's height—without a wrapper
  height `<estela-workspace>` expands to 4410 px (breaking ledger virtualization) and the 128 px sticky composer seat
  covers the bottom of the ledger and inspector. A `ResizeObserver` (with a `MutationObserver` on the scroll body's
  children) therefore sets the wrapper's height in pixels to the nearest vertically scrollable ancestor's `clientHeight`
  minus any bottom-docked overlay sibling's height in that ancestor.

#### 3.4.2 Appearance

`src/client/appearance.ts` maps `ctx.theme.getTheme().active.colorScheme` to `data-theme`,
`ctx.locale.getLocale().active` to `lang` (`zh` to `zh-CN`, anything else to `en`, the rule of
`apps/web/src/i18n/locale.ts:36-43`), and dsh's live `--dsw-*` / `--ds-*` tokens (preferring any active theme override
in `snapshot.active.tokens`, else referencing `var(--dsw-...)` with no hardcoded hex values) to `--estela-host-*`
custom properties on `<estela-workspace>` (background, secondary/inspector surface, muted chip fill, hover accent,
borders, text hierarchy, link/selection accent, error color, text/code font stacks, and control radius). When a host
variable is absent, CSS falls back to Estela's own `:host` palette. It subscribes to `ctx.on('theme/change', ...)` and
`ctx.on('locale/change', ...)` inside `ctx.effect`, removes the `--estela-host-*` properties on dispose, and never
writes `document.documentElement`. The tab label "Estela" is a product name and is not translated.

### 3.5 Package, manifest, and bundles

#### 3.5.1 Manifest and files

```json
{
  "name": "@rivus/dsh-estela",
  "description": "Estela view of the current DeepSeek Harness session: ledger, Model saw, Compare, and cost.",
  "license": "GPL-3.0-only",
  "type": "module",
  "private": true,
  "engines": { "dsh": ">=0.2.2-rc.5 <0.3.0-0", "node": ">=24.9.0" },
  "exports": {
    ".": "./dist/host.mjs",
    "./client": "./dist/client.js",
    "./icon": "./assets/icon.png",
    "./package.json": "./package.json"
  },
  "files": ["dist/host.mjs", "dist/client.js", "cordis.patch.yml", "dist/THIRD-PARTY-NOTICES.txt", "assets", "README.md", "LICENSE", "CHANGELOG.md"],
  "dsh": { "manifestVersion": 1, "bundle": { "patch": "./cordis.patch.yml" }, "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-theme", "@deepseek-ai/dsh-client-locale"] } }
}
```

- `cordis.patch.yml` ships in the tarball and is `- insert: [{ id: estela, name: '@rivus/dsh-estela' }]`. A package
  packed without it installs but does not activate. `src/package.test.ts` packs the package and checks that the
  archive holds the file `dsh.bundle.patch` names.
- `"private": true` stays until batch 10 (T23).
- `publishConfig.access` is `public`; `repository` is the repository with `directory: "apps/dsh-plugin"`, which the
  listing requires for the npm link.
- `assets/icon.png` is a square raster made from `docs/assets/logo.svg`. `README.md` says how to install, what the
  View shows, its limits, and the license; it is the detail page of dsh's Plugins page.
- `package.json` has no `bin`, no `dependencies`, and no `peerDependencies` (T20). The dsh client packages are
  devDependencies pinned at `0.2.2-rc.5`, for their types only, with `@types/react` 18.

#### 3.5.2 Bundles

- `vite.config.ts` uses `vp pack` with the entry `host` (`src/host/index.ts`, Node 24 target, `failOnWarn`, the
  notices plugin).
- `scripts/build-client.mjs` bundles `src/client/index.ts` in one pass with `react` and `react/jsx-runtime` left as
  `require(...)` calls, the element taken from `@rivus/estela-web/embed` with its style sheet, and writes:

```js
window.__ModuleLoader__.load({
  id: '@rivus/dsh-estela',
  factory(require) {
    /* the bundle */
    return { inject, apply }
  },
})
```

  Files under `apps/web` compile with `vite-plugin-solid`; the client half has no JSX (T17). A test loads
  `dist/client.js` in a Node `vm` context with a fake `window.__ModuleLoader__` and a fake `require`, and checks
  that the registered module has `inject` and `apply`.
- A test lists every import specifier of the built `dist/host.mjs`, static and dynamic, and asserts that neither
  `devframe` nor `node:sqlite` is among them. `node:sqlite` reaches a bundle only through the session index, which
  the catalog opens; the core does not import the catalog (3.1.2), and the plugin runs none.
- The plugin defines no global. The custom element's name stays registered for the life of the page, including
  after the plugin is removed; that is the browser's rule and holds no data.

#### 3.5.3 What the plugin owns and recovers

dsh removes what was registered through `ctx`: the channel, the slot entry, the theme and locale subscriptions.
The plugin owns two more things and recovers both in its disposers: the core (holds released) and, per
element, the document-level `<style>` (removed with the last element).

### 3.6 Layers, lint, and tooling

- `AGENTS.md`, Layers table: one row for `apps/dsh-plugin` (`@rivus/dsh-estela`): it owns the dsh host half, the
  client half, the manifest, and the two bundles; it may depend on `server` (its `core` entry), `web` (its `embed`
  entry), and the types of `rpc`, `schema`, and `@rivus/agent-kit`. The `packages/server` row gains `createEstelaCore`
  and the `core` entry; the `apps/web` row gains the `embed` entry.
- `AGENTS.md`, Rules: the entry-point rule names `createEstelaCore` for the plugin, and the sentence that the RPC
  bindings are module state (also `docs/architecture/overview.md`, Server composition) is replaced.
- `scripts/check-layers.mjs`: `ALLOW['@rivus/dsh-estela'] = [SERVER, WEB, KIT, RPC, SCHEMA]`.
- Root `vite.config.ts`, three overrides and one rule that already applies:
  - `apps/dsh-plugin/src/host/**`: no import of `devframe`, and no import of the `@rivus/estela-server` root entry.
  - `apps/dsh-plugin/src/client/**`: nothing imported at runtime from outside `src/client/**`, `src/contract/**`,
    and `@rivus/estela-web/embed`.
  - `packages/server/src/core/**`: no import of `devframe`, and none from `packages/server/src/catalog/`.
  - The existing rule that keeps the kit type-only already covers `apps/dsh-plugin`, because it excludes only
    `apps/cli/**` and `packages/server/**` (`vite.config.ts:79`).
- `knip.ts`: `'apps/dsh-plugin'` with `project: projectWithout(['scripts', 'test'])`, as `apps/cli` has.
- `scripts/third-party-notices.ts` moves from `apps/cli/scripts/` to `scripts/`, because both pack configs use it.

### 3.7 Release and documents

- The package is `private: true` until batch 10. No changeset may name a private package, and the release workflow
  looks up a public package with no version on npm on every push to `main`. So batch 10 makes the plugin public,
  bootstrapped on npm, covered by the release checks and the interface documents, and named in its first changeset,
  all in one pull request (T23). `.changeset/config.json` is unchanged.
- From then on, a pull request that changes what the plugin ships (`apps/dsh-plugin/`, `apps/web/`, any `packages/`)
  carries a changeset naming `@rivus/dsh-estela`; an edit under `apps/web/` or `packages/` names both published
  packages, as an edit of a bundled package names the CLI today. `CONTRIBUTING.md` (Release Intent, Bot Pull
  Requests) says so.
- `.github/workflows/publish.yml`:
  - `check-command` becomes `pnpm -C apps/e2e run test:smoke && pnpm --filter '@rivus/dsh-estela...' run build`.
    The dsh smoke stays in CI, which runs on the version pull request.
  - `audit-command` adds the filter `'@rivus/dsh-estela...'`.
  - The dry-run job builds the plugin and saves `pnpm --filter @rivus/dsh-estela pack` beside the CLI tarball.
- `docs/reference/public-interface.md` gets a section "dsh plugin (`@rivus/dsh-estela`)" under Covered: the package
  name, the install and remove commands, the tab labeled "Estela", the `engines.dsh` range, the effect of
  `ESTELA_REDACT=0`, and that the plugin has no configuration. Its version policy is the 0.x policy of the CLI; a
  narrower `engines.dsh` range is breaking and ships in a minor release. "Not covered" gains the plugin's channel,
  the element, and the package's files. The Compatibility section of `docs/architecture/overview.md` drops the
  sentence about a public `@rivus/estela/server` entry.
- `scripts/check-release-intent.mjs`: a change whose lines fall under the plugin's section needs a release changeset
  for `@rivus/dsh-estela`; a change anywhere else in the file needs one for `@rivus/estela`; both regions changed
  need both. It reads the hunk ranges of `git diff --unified=0` and finds each range's nearest heading.
- `docs/guide/dsh-plugin.md` and its Chinese copy: install, what the View shows, that a session must have started,
  the snapshot limit, redaction, uninstalling, and the version range. `docs/guide/README.md` links it, and
  `docs/guide/troubleshooting.md` gets one entry for "dsh says the plugin is incompatible".
- `docs/development/setup.md`: the smoke command and the CI job; the acceptance table gains DSH-1 to DSH-14.
- Every changed English document gets its `.zh-CN.md` copy in the same pull request.

### 3.8 Security and privacy

- The channel is registered through `ctx.connection`, so every call passes dsh's admission first (A2, section 5).
  The handler then refuses a peer whose principal is not `owner` (T12). The plugin adds no route of its own.
- The log is read in dsh's process and sent only to dsh's page. Nothing is written.
- Session content is drawn as text by the workspace, as in the CLI; the plugin adds no rendering of its own.
- `client.js` is served without a cookie, like every plugin bundle. It holds code only.

### 3.9 Smoke test and CI

- `apps/dsh-plugin/test/dsh.smoke.ts` runs under `vp test` with the script `test:smoke`, not part of `pnpm test`. It
  packs the plugin, installs a pinned dsh (`DSH_VERSION = '0.2.2-rc.5'` in the file) with
  `npm i --prefix <tmp> @deepseek-ai/dsh@<version> --registry https://registry.npmjs.org/`, sets `DSH_HOME` to a
  temporary directory and `HOME` to a fake one, and starts `dsh web` from that prefix on loopback with no model key.
  It dismisses the two dialogs of a fresh `DSH_HOME` (A2, section 3), drives the page with Playwright, and stops dsh
  in `afterAll`. `ESTELA_DSH_VERSION` overrides the version for the canary run.
- A session gets into the temporary `DSH_HOME` by A2's seed (section 3). `test/seed-session.mjs` applies it to
  `fixtures/sessions/dsh/conformance/plain`: the header in one zstd frame and the events in another, a `turn/start`
  added (the conformance fixtures have none, so a session seeded from them alone stays blank), the sequence numbers
  made contiguous, and the session id registered in `storages/workspace.json` under the workspace path. One user
  message is replaced by the fake home path for DSH-10. The smoke asserts that the Estela tab appears on the seeded
  session before it tests the content.
- The seed also writes a large session for DSH-7: the fixture's events repeated many times behind the `turn/start`,
  with contiguous sequence numbers. While the plugin loads it, the smoke sends a request that dsh serves itself and
  records its latency. `DSH_LOAD_STALL_MS`, next to `DSH_VERSION`, is that measurement with the headroom the other
  time budgets have; the smoke fails above it. Which dsh request to send is unconfirmed until the first run; a
  session list read is the candidate. A load that cannot stay under the limit needs a worker, designed in its own
  issue.
- A unit test asserts that `engines.dsh` in `package.json` starts at `DSH_VERSION`, so the range and the tested
  version cannot drift apart (D2).
- Scenarios: DSH-1, DSH-2, DSH-3 (a new session: no tabs, no command named estela), DSH-6 (a transport failure
  while the View is mounted), DSH-7, DSH-10, DSH-11 (a `cordis.patch.yml` that selects light and Chinese before
  the start), DSH-12 (`remove` while `dsh web` runs: the channel answers 405 and the tab disappears; the listening
  sockets of the dsh process before and after; the profile's `package.json` and `node_modules`), DSH-13 (a repacked
  tarball with `engines.dsh: ">=99"` is refused with exit 1; a profile whose installed copy declares it starts
  without the tab), DSH-14 (no cookie is 401; another `Origin` is 403).
- `.github/workflows/ci.yml` gets a job `dsh-plugin` beside `test` and `platforms`: `ubuntu-latest`, Node.js
  `^26.13.1`, 30 minutes, the same pull request condition as the others, steps `pnpm --filter @rivus/estela-web run
  build`, `npx playwright install --with-deps chromium`, `pnpm -C apps/dsh-plugin run test:smoke`. The job also runs
  on `schedule` (weekly) and `workflow_dispatch`, with dsh's `latest` tag; those runs are not required checks.
- The `test` job builds the plugin before the budgets step (3.10).

### 3.10 Budgets

`scripts/budgets/budgets.mjs` gains `dsh-client-raw`, `dsh-client-gzip` (`dist/client.js`), `dsh-host`
(`dist/host.mjs`), and `dsh-tarball` (`pnpm pack` of `apps/dsh-plugin`), all `enforced: true` and `unit: 'bytes'`.
Their limits are unconfirmed: batch 9 sets each about 20 % above the first measurement, as the file's header
prescribes. `scripts/budgets/sizes.mjs` measures them, and the `test` job runs
`pnpm --filter '@rivus/dsh-estela...' run build` before `node scripts/check-budgets.mjs`.

### 3.11 Listing

- Manual, owner: add the `dsh-plugin` topic to the repository.
- The entry file is `data/plugins/PerfectPan__estela--apps-dsh-plugin.yml` in awesome-dsh-plugin. The repository slug
  is `PerfectPan/estela` (`apps/cli/package.json:9`, the `origin` remote), so the name mismatch the spike reported is
  gone.
- Proposed content is in Appendix B. The description names only what Spec 0010 requires.
- How it differs from the listed session viewers, from their listing descriptions (their code was not read):
  `dsh-session-lazy-view` is a session list that decompresses the tail of each log and exports; Estela has no session
  list and reads the whole log of the open session. `llm-capture` records raw requests and responses while they
  happen; Estela records nothing and reads the log dsh already wrote, so it also works for sessions recorded before
  the plugin was installed. `dsh-llm-inspector` tunes reasoning effort and exports thinking; Estela changes nothing.
  `dsh-context-console` creates, injects, and repairs session messages; Estela only reads.
- The pull request to awesome-dsh-plugin is the last step and needs the owner's confirmation.

## 4. Rollout and stability

### 4.1 Gates and rollout stages

1. This plan reviewed.
2. Batches 1 and 2 merged: the command line is unchanged, proven by its suites.
3. Batches 3 to 5 merged: the CLI is unchanged, proven by its suites; the element has its own tests.
4. Batches 6 to 9 merged; the `dsh-plugin` CI job is green on the pinned dsh. The package is still private.
5. Manual: the owner publishes the bootstrap version of `@rivus/dsh-estela` on npm, as
   `CONTRIBUTING.md#publishing-to-npm` describes for a new package.
6. Batch 10 merged: the package becomes public in the same pull request as the interface documents and the first
   changeset, so the push to `main` opens the version pull request.
7. Manual, right before the version pull request is marked ready: the owner configures the trusted publisher
   (GitHub owner `PerfectPan`, repository `estela`, workflow `publish.yml`, no environment, "Allow npm publish" on).
   A new trusted publisher expires after two days without a publish.
8. The version pull request is merged; the Publish workflow releases the plugin. Verified with
   `npm view @rivus/dsh-estela` and a clean install into a scratch dsh profile.
9. The owner confirms; the listing pull request is opened.

### 4.2 Signals and alerts

- The `dsh-plugin` job on every pull request: the pinned dsh.
- The weekly run against dsh's `latest`: a red run means a new dsh release breaks the plugin or its install. The
  owner then fixes the plugin and releases with a new `engines.dsh` range (D2).
- `npm view @rivus/dsh-estela` and the GitHub Release after each publish.

### 4.3 Rollback

- Before a release: revert the pull request of the batch. No data is persisted, so a revert is complete.
- After a release: `npm deprecate @rivus/dsh-estela@<version> "<reason>"` and, if needed,
  `npm dist-tag add @rivus/dsh-estela@<previous> latest`. Users run `dsh plugin --profile web remove
  @rivus/dsh-estela`; nothing is left behind (DSH-12). An npm version is never overwritten or unpublished.
- The command line is rolled back independently: its release does not depend on the plugin's.

## 5. Verification

### 5.1 Functional checks

- `packages/rpc`: the input and handler tests (`functions/handler-input.test.ts`, `functions/trace-view.test.ts`) run
  against factories; a new test builds two function sets over two stores and checks that each answers with its own.
- `packages/server/src/core/estela-core.test.ts`: two cores in one process read different fixtures, and a core
  reaches neither DevFrame nor the catalog (the import specifiers of the built `dist/host.mjs`, 3.5.2).
- `apps/web/src/embed/*.test.ts`: the style sheet split (60 `@property` rules, nothing cut; no `@font-face` in the
  embed style sheet); the element's theme and language attributes; "no log yet"; the unknown-format hint and link;
  no back link, switches, or export button; a source that throws shows "could not load"; `open` refuses once and
  then resolves, and the element is not replaced.
- `apps/web/src/workspace/workspace.test.tsx`: the shell split (3.2.5).
- `apps/dsh-plugin/src/host/*.test.ts`: every endpoint's results and refusals with a fake `ctx` (DSH-4, DSH-5,
  DSH-9, DSH-10, DSH-14); `estela/stale` for an evicted id whose file changed; the unknown-generation message for
  dsh's own format refusal; an exception inside the handler becomes `estela/failed`; the `rpc` getter call is used.
- `apps/dsh-plugin/src/package.test.ts`: the manifest (`engines.dsh` starts at `DSH_VERSION`, no `dependencies`, no
  `peerDependencies`, the exports name files a build writes) and the packed archive (`cordis.patch.yml` is the file
  `dsh.bundle.patch` names).
- `apps/dsh-plugin/scripts/build-client.test.ts`: `dist/client.js` registers a module with `inject` and `apply`.
- `apps/e2e/src/e2e/embed.e2e.ts`: S7 and CD-S1 on the element with an in-page source, from A1's harness page; the
  host page's URL does not change.

### 5.2 Failure and retry checks

- A `trace/view` call whose `signal` fires releases its hold and, as the last holder, aborts the load.
- An unknown format generation, a missing file, and an unreadable file each return `estela/failed` with the store's
  message or the fixed one (DSH-5).
- A call that is still running when the plugin is disposed ends with `estela/closed`; a call made after the unload
  gets 405 from dsh and never reaches the handler.
- A rendering error inside the element leaves the page and its other Views working (DSH-6), and a transport failure
  while the View is mounted shows "Try again", which opens the session again.

### 5.3 Compatibility checks

- The CLI: `cd apps/e2e && pnpm run test:smoke` and `pnpm run test:e2e` unchanged.
- `node scripts/check-layers.mjs`, `node scripts/lint-scripts.mjs`, `pnpm lint`, `pnpm typecheck`,
  `node scripts/format.mjs --check`, the schema package's `duplicates`, `knip`, and `knip:production`.
- dsh: the smoke on the pinned version; the canary on `latest`.

### 5.4 End-to-end acceptance

The scenarios the Spec assigns to `dsh.smoke.ts` pass there, with the CI job green and its log attached to the pull
request.

## 6. Execution plan

### 6.1 Preconditions

- `@rivus/dsh-estela` free on npm (checked 2026-11-24).
- For batch 11: the package's bootstrap version and trusted publisher (4.1, steps 5 and 7).

### 6.2 Completion contract

| Scenario | Batch | Proof |
|---|---|---|
| DSH-1 | 8 | `dsh.smoke.ts` |
| DSH-2 | 3, 4, 5, 7, 8 | `dsh.smoke.ts`; `apps/e2e` S2, S7, CD-S1; `embed.e2e.ts` |
| DSH-3 | 8 | `dsh.smoke.ts` |
| DSH-4 | 4, 7 | `apps/web/src/embed`; `src/host/channel.test.ts` |
| DSH-5 | 3, 7 | `apps/web/src/embed`; `src/host/channel.test.ts` |
| DSH-6 | 5, 8 | `embed.e2e.ts`; `dsh.smoke.ts` |
| DSH-7 | 4, 8 | `apps/web/src/embed`; `dsh.smoke.ts` records the stall |
| DSH-8 | 8 | `packages/kernel/src/view.test.ts`; the measurement of A2, section 2 |
| DSH-9 | 7 | `src/host/sessions.test.ts`: a changed log gets a new id and is read again; an evicted snapshot whose file changed is refused as stale |
| DSH-10 | 7, 8 | `src/host/channel.test.ts`; `dsh.smoke.ts` |
| DSH-11 | 3, 7, 8 | `apps/web/src/embed`; `src/client/appearance.test.ts`; `dsh.smoke.ts` |
| DSH-12 | 8 | `dsh.smoke.ts` |
| DSH-13 | 6, 8 | `src/package.test.ts`; `dsh.smoke.ts` |
| DSH-14 | 7, 8 | `src/host/channel.test.ts`; `dsh.smoke.ts` |

Done means: every scenario's test exists and passes, the checks of 5.3 pass, the documents of 3.7 are updated with
their Chinese copies, and the plugin's first version is published.

### 6.3 Execution order

Batches 1 and 2 need nothing further. Batches 3 and 6 can run at the same time as each other. Batches 8 and 9 need 7.

#### Batch 0: server prerequisites (delivered)

PR #172, merged as `44cb909`: `close()` stops the summary queue, `redacts` is the one switch for session text, and
`reportDir` names the report directory. Batches 1 and 2 build on it as merged.

#### Batch 1: RPC services per instance (`packages/rpc`, `packages/server`, one pull request)

- Files: `packages/rpc/src/functions/{service,trace-view,report,list-sessions}.ts`, `packages/rpc/src/index.ts`,
  `packages/rpc/src/publish.ts`, `packages/rpc/src/functions/{handler-input,trace-view}.test.ts`,
  `packages/server/src/composition/{definition,estela-server}.ts`, `packages/server/src/catalog/session-catalog.ts`,
  `packages/server/src/report/report.ts`, `packages/server/test/export-report.test.ts`,
  `apps/cli/src/entry/commands/build.ts`, `apps/cli/test/report-build.test.ts`.
- Change: 3.1.1. The `bind*` exports and the two function constants go away; the factories, the publisher, and the
  report source take their place; `EstelaServer.writeReport` replaces the free `writeReport`.
- Tests: the existing handler tests through the factories; a new case with two function sets over two stores; the
  catalog announces through `announce`.
- Exit condition: `pnpm --filter @rivus/estela-rpc test`, `pnpm --filter @rivus/estela-server test`, `pnpm typecheck`,
  and the CLI smoke pass; `grep -rn "bindTraceStore\|bindSessionService\|bindReportExporter\|bindReportSource\|bindSessionPublisher\|emitSessions" apps packages` prints nothing.
- Effort: 45 to 60 minutes.

#### Batch 2: the DevFrame-free core (`packages/server`)

- Files: `packages/server/src/core/estela-core.ts`, `packages/server/src/core/estela-core.test.ts`,
  `packages/server/src/composition/estela-server.ts`, `packages/server/src/store/trace-store.ts`,
  `packages/server/src/index.ts`, `packages/server/package.json`, root `vite.config.ts`, `AGENTS.md`,
  `docs/architecture/overview.md` and `.zh-CN.md`.
- Change: 3.1.2 and the lint override of 3.6. The service construction moves from `createEstelaServer` to
  `createEstelaCore`; the catalog stays in the composition and hands the core its resolver; the `./core` entry; the
  rule text that says the bindings are module state is replaced.
- Tests: 5.1, second bullet.
- Exit condition: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `node scripts/check-layers.mjs`, and
  `node scripts/check-doc-translations.mjs` pass; the CLI smoke passes.
- Effort: 45 to 60 minutes.

#### Batch 3: `apps/web` in a shadow root (`apps/web`)

- Files: `apps/web/src/styles.css`, `apps/web/src/shell/{theme,top-bar}.ts(x)`, `apps/web/src/i18n/locale.ts`,
  `apps/web/src/i18n/dictionary.{en,zh-CN}.ts`, `apps/web/src/app.tsx`, `apps/web/src/shell/app-shell.tsx` (new),
  `apps/web/src/workspace/{workspace,error-panel,load-session}.ts(x)`, `apps/web/src/workspace/workspace.test.tsx`
  (new), `apps/web/src/workspace/inspector/inspector.tsx`, `apps/web/src/workspace/timeline/timeline.tsx`.
- Change: rows A3, A4, A5, A9, B1 to B6, and B8 of 3.2.2, and the shell split (3.2.5).
- Tests: the unit tests beside the changed files, `workspace.test.tsx` among them; the CLI's Playwright suite
  unchanged and green, including S11 and S14, which cover the theme and the language in the page.
- Exit condition: `pnpm --filter @rivus/estela-web test`, `lint`, `typecheck`, and `cd apps/e2e && pnpm run test:e2e`
  pass.
- Effort: 45 to 60 minutes.

#### Batch 4: the element and the embed build (`apps/web`)

- Files: `apps/web/src/embed/{index,estela-workspace,source,load-client,stylesheet}.ts`,
  `apps/web/src/embed/*.test.ts`, `apps/web/vite.config.ts`, `apps/web/package.json`, `.gitignore`.
- Change: 3.2.1, 3.2.3, 3.2.4; rows A1, A2, A6, and B10 of 3.2.2. The load path (loading, ready, the two error
  states) is new here and was not run by A1.
- Tests: 5.1, third and fourth bullets.
- Exit condition: the embed tests pass; `vp build --mode embed` writes `dist-embed/`, and the built style sheet holds
  no `@font-face` and the 60 `@property` rules; the CLI tarball file list is unchanged.
- Effort: 60 minutes.

#### Batch 5: the element in a browser (`apps/e2e`)

- Files: `apps/e2e/src/e2e/embed.e2e.ts`, `apps/e2e/src/e2e/harness.ts`, a harness page under `apps/e2e`.
- Change: A1's harness page, mounted on `dist-embed/` with an in-page source; S7 and CD-S1 on the element; the check
  for the rows marked "read" in 3.2.2 (the host page's URL is unchanged); a source that throws (DSH-6); a slow
  source (DSH-7).
- Tests: the suite is the test.
- Exit condition: `cd apps/e2e && pnpm run test:e2e` passes with the new file.
- Effort: 45 to 60 minutes.

#### Batch 6: package skeleton, manifest, and layers (`apps/dsh-plugin`, repository tooling)

- Files: `apps/dsh-plugin/{package.json,cordis.patch.yml,README.md,LICENSE,tsconfig.json,vite.config.ts}`,
  `apps/dsh-plugin/assets/icon.png`, `apps/dsh-plugin/src/contract/channel.ts`,
  `apps/dsh-plugin/src/package.test.ts`, `apps/dsh-plugin/scripts/build-client.mjs`,
  `apps/dsh-plugin/scripts/build-client.test.ts`, `AGENTS.md`, `scripts/check-layers.mjs`, root `vite.config.ts`,
  `knip.ts`, `scripts/third-party-notices.ts` (moved), `apps/cli/vite.config.ts`, `pnpm-lock.yaml`.
- Change: 3.5.1, 3.5.2, 3.6. The package builds an empty host entry and an empty client entry and passes every
  repository check.
- Tests: the manifest test, the packed archive test, and the bundle test of 5.1.
- Exit condition: `node scripts/check-layers.mjs`, `pnpm lint`, `pnpm typecheck`, and both knip runs pass;
  `pnpm --filter '@rivus/dsh-estela...' run build` writes both bundles; `pnpm --filter @rivus/dsh-estela pack`
  produces an archive that holds the file `dsh.bundle.patch` names; the CLI tarball file list is unchanged.
- Effort: 45 to 60 minutes.

#### Batch 7: the host half and the client half (`apps/dsh-plugin`)

- Host files: `apps/dsh-plugin/src/host/{index,rpc,channel,sessions}.ts`, `apps/dsh-plugin/src/host/*.test.ts`.
  Change: 3.3. Tests: 5.1, fourth bullet; 5.2.
- Client files: `apps/dsh-plugin/src/client/{index,estela-view,appearance}.ts`,
  `apps/dsh-plugin/src/client/appearance.test.ts`. Change: 3.4.
- The client half starts with two checks in dsh, each kept as a smoke scenario in batch 8: the element's height
  inside dsh's View area (T25), and that `dsh.client.inject` with two packages loads the theme and locale services
  for a third-party plugin.
- Exit condition: `pnpm --filter @rivus/dsh-estela test`, `lint`, `typecheck`, and `build` pass; `dist/host.mjs`
  imports neither `devframe` nor `node:sqlite`.
- Effort: two steps of 45 to 60 minutes.

#### Batch 8: smoke test and CI job

- The seed, the large session, and the stall measurement follow 3.9.
- Files: `apps/dsh-plugin/test/dsh.smoke.ts`, `apps/dsh-plugin/test/seed-session.mjs`,
  `apps/dsh-plugin/package.json` (`test:smoke`), `apps/dsh-plugin/vite.config.ts`, `.github/workflows/ci.yml`,
  `docs/development/setup.md` and `.zh-CN.md`.
- Change: 3.9.
- Tests: the smoke is the test.
- Exit condition: `cd apps/dsh-plugin && pnpm run test:smoke` passes locally against the pinned dsh and in the
  `dsh-plugin` job; no `dsh` process and no port of the run remain afterwards.
- Effort: 60 minutes.

#### Batch 9: budgets and release plumbing

- Files: `scripts/budgets/{budgets,sizes}.mjs`, `scripts/check-budgets.mjs`, `.github/workflows/ci.yml`,
  `.github/workflows/publish.yml`, `scripts/check-release-intent.mjs` and its test, `CONTRIBUTING.md`.
- Change: 3.10 and the workflow and script parts of 3.7.
- Tests: `check-release-intent.mjs` gets cases: a change in the plugin section, elsewhere, and in both.
- Exit condition: `node scripts/check-budgets.mjs` prints the four new rows and passes;
  `gh repo-checks release-plan` passes; the Publish dry run saves both tarballs.
- Effort: 45 to 60 minutes.

#### Batch 10: public, documents, and the first changesets

- Files: `apps/dsh-plugin/package.json` (`private` removed, `publishConfig` added), `docs/reference/public-interface.md`
  and `.zh-CN.md`, `docs/guide/dsh-plugin.md` and `.zh-CN.md`, `docs/guide/{README,troubleshooting}.md` and copies,
  `docs/architecture/overview.md` and copy, `README.md` and copy, `.changeset/` records for `@rivus/dsh-estela` and
  `@rivus/estela`.
- Change: 3.7. The package becomes public here, in the same pull request as the interface documents and the first
  changeset (T23).
- Exit condition: `node scripts/check-doc-translations.mjs` and `gh repo-checks release-plan` pass.
- Effort: 45 to 60 minutes.

#### Batch 11: listing (last; needs the owner)

- Add the `dsh-plugin` topic; open the pull request with the entry of Appendix B after the owner confirms.
- Exit condition: the listing pull request is open (the acceptance criterion of #109).
- Effort: 30 minutes and the maintainers' review.

### 6.4 Validation ledger

| Batch | Command or evidence | Expected result |
|---|---|---|
| 1 | `pnpm --filter @rivus/estela-rpc test`; `pnpm --filter @rivus/estela-server test`; `pnpm typecheck` | all pass |
| 1 | `cd apps/e2e && pnpm run test:smoke` | unchanged scenarios pass |
| 1 | the `grep` of batch 1 | no output |
| 2 | `pnpm lint`; `pnpm test`; `node scripts/check-layers.mjs` | pass |
| 2 | `node scripts/check-doc-translations.mjs` | pass |
| 3 | `pnpm --filter @rivus/estela-web test`; `cd apps/e2e && pnpm run test:e2e` | pass, e2e unchanged |
| 3 | A1's screenshot comparison, rerun on the merged page build | the page differs in 0 pixels from `main` |
| 4 | A1's comparison with the element built by batch 4, dark and light, nine scenes | dark 0; light at most 46 pixels |
| 5 | `cd apps/e2e && pnpm run test:e2e` | pass, with `embed.e2e.ts` |
| 6 | `pnpm --filter @rivus/estela-schema run knip`; `run knip:production`; `pnpm --filter @rivus/dsh-estela pack` | pass; the archive holds `cordis.patch.yml` |
| 7 | `pnpm --filter @rivus/dsh-estela test`; `run build` | pass; the import specifiers of `dist/host.mjs` hold neither `devframe` nor `node:sqlite` |
| 8 | `cd apps/dsh-plugin && pnpm run test:smoke`; the log of CI job `dsh-plugin` | DSH-1 to DSH-3, DSH-6, and DSH-7 pass, DSH-10 to DSH-14 pass |
| 9 | `node scripts/check-budgets.mjs`; `gh repo-checks release-plan` | pass |
| 10 | `node scripts/check-doc-translations.mjs`; `gh repo-checks pr-body pr-body.md` | pass |
| 11 | the listing pull request | open |

### 6.5 Rollback per batch

- Batches 1 to 10: one pull request each; revert it. Nothing is persisted, so a revert is complete. Batches 1 to 5
  change what the CLI ships and carry their own changesets for `@rivus/estela`, so the CLI can release without the
  plugin.
- Release order: the plugin's first release needs batches 1 to 10. The CLI can release after batch 5.
- Batch 11: close the listing pull request, or ask the list's maintainers to remove the entry.

### 6.6 Work split and schedule

| Batch | Owner | Depends on | Effort | When |
|---|---|---|---|---|
| 0 | delivered | none | done (`44cb909`) | done |
| 1 | unconfirmed | 0 | 45 to 60 min | unconfirmed |
| 2 | unconfirmed | 1 | 45 to 60 min | unconfirmed |
| 3 | unconfirmed | none | 45 to 60 min | unconfirmed |
| 4 | unconfirmed | 3 | 60 min | unconfirmed |
| 5 | unconfirmed | 4 | 45 to 60 min | unconfirmed |
| 6 | unconfirmed | 2, 3 | 45 to 60 min | unconfirmed |
| 7 | unconfirmed | 4, 6 | 2 × 45 to 60 min | unconfirmed |
| 8 | unconfirmed | 7 | 60 min | unconfirmed |
| 9 | unconfirmed | 7 | 45 to 60 min | unconfirmed |
| 10 | unconfirmed | 7, the npm bootstrap | 45 to 60 min | unconfirmed |
| 11 | owner | the first release | 30 min and the maintainers' review | unconfirmed |

The effort is agent work on one batch, including its tests; it is not a commitment.

## 7. Risks, open questions, and follow-up

What neither verification covered. Each row says where it is settled.

| Item | Type | Impact | Owner | Next step or deadline |
|---|---|---|---|---|
| A large load blocks dsh's event loop for longer than the smoke limit (T10). | risk | `dsh web` stalls its own requests while a session loads. | unconfirmed | Batch 8 measures it. A load that cannot stay under the limit gets a worker, designed in its own issue. |
| The element's height inside dsh's View area (T25). | resolved | A collapsed ledger, or a composer overlay over the inspector. | batch 7 | Measured in batch 7 on dsh 0.2.2-rc.5: without height sizing the element expands to 4410 px and sits under the 128 px sticky composer seat. `src/client/view-height.ts` sizes the wrapper to the nearest scroll ancestor's `clientHeight` minus bottom overlay height. |
| `dsh.client.inject` with two packages, and `ctx.theme`, `ctx.locale` for a third-party client plugin. | resolved | Theme and language would have to be read from dsh's document attributes instead. | batch 7 | Verified in batch 7 on dsh 0.2.2-rc.5: both packages inject `ctx.theme` (`getTheme()` / `theme/change`) and `ctx.locale` (`getLocale()` / `locale/change`) into a third-party client plugin and deliver live updates. |
| The load path of the element (loading, ready, errors). | open question | Not run by A1. | unconfirmed | The tests of batch 4 and the suite of batch 5. |
| Whether the handler's `signal` fires when the browser cancels. | open question | A load no one waits for runs to its end and is dropped. | unconfirmed | Accepted if it does not; noted in batch 7. |
| dsh is a release candidate and its extension points promise no compatibility (D2). | risk | A dsh release can break the channel call, the View, or the bundle format. | unconfirmed | The pinned smoke job and the weekly `latest` run. |
| The `rpc` getter call (T11). | risk | It relies on `rpc` being a getter on the service's prototype. | unconfirmed | The fallback in `src/host/rpc.ts`; the smoke job. |
| `client.js` loads on every dsh page load: at most about 122 kB gzip (T18). | risk | Users who never open the View download it. | unconfirmed | The size budgets of 3.10; a second file when dsh's loader for it is verified. |
| A View stays mounted while its tab is not selected (pins). | risk | A session loaded once stays on screen after the log grew, until a reload or a session switch. | unconfirmed | Accepted by DSH-9; live follow is #104. |
| The same size and timestamp after a rewrite hide a change. | risk | A stale view until the next append. | unconfirmed | Accepted; noted in 3.3.3. |
| Only Chrome was run (A1), and only a simulated host page. | risk | Another engine or dsh's real page may render differently. | unconfirmed | The smoke job runs in dsh's real page, on Chromium. |
| "Export report" in dsh. | follow-up | Users who install only the plugin cannot make a report. | unconfirmed | Needs a save location in dsh, the report build inside a foreign process, and a silent build log. |
| A session browser inside dsh. | follow-up | Other agents' sessions are not reachable from dsh, and a blank session has no entry. | unconfirmed | Needs a verification of an entry other than `conversation.view`. |
| A large dsh log for the smoke test. | follow-up | DSH-8 is proven by the kernel tests and A2's measurement, not through the plugin in dsh. | unconfirmed | A generator for dsh logs of a given size. |
| dsh Desktop and the TUI profile. | follow-up | Not supported. | unconfirmed | A verification of `dsh-app://` and of a TUI footer field. |

## Appendix

### A. dsh behavior that Spec 0010 relies on

- Install refusal, source `packages/boot/plugin-manager/src/operations.ts:351-356`, `:363-381`: the diagnostic
  starts `dsh: installation rejected:`, continues with `Plugin <name>@<version> is incompatible with dsh <version>:
  requirements {...}. Running it may cause crashes or data loss. ...`, names `dsh plugin allow-version`, and ends
  `dsh: nothing was installed.`; the exit code is 1. The wording is dsh's and may change; DSH-13 checks the refusal
  and the exit code, not the wording.
- Profile start, `packages/boot/app-boot/src/compatibility-preflight.ts:79-83`, `:101-117`: the row gets `disabled`,
  and stderr gets `dsh: disabling profile plugin <id>: <the same diagnostic>`.
- Both checks call the same `satisfies` with `includePrerelease: true`
  (`packages/boot/app-boot/src/plugin-compatibility.ts:51-53`).
- A blank session has no View tabs: `DefaultConversationViews.tsx` returns `null` while the session is blank, and a
  session is blank until `turn/start` (`api/session-controller/src/list.ts:51`).
- A slot entry cannot select a View: the selected View is the conversation store's `view`
  (`ui-conversation/src/client/skeleton/DefaultConversationViews.tsx:19-20`), and only components rendered with that
  store reach its actions (`ui-conversation/src/client/apply.ts:457-460`). dsh's own sidebar-terminal plugin mounts a
  component that returns `null` on `conversation.session.header.actions`; entries there receive the standard session
  props, not the store.

### B. Proposed listing entry

```yaml
url: https://github.com/PerfectPan/estela/tree/main/apps/dsh-plugin
name: PerfectPan/estela#dsh-plugin
category: session
description:
  en: 'Adds an Estela view beside Chat and Trajectory that reads the current session log from disk: the ledger, what the model saw at a request, a context compare, what a compaction removed, and list-price cost.'
  zh: '在 Chat 和 Trajectory 旁增加 Estela 视图，从磁盘读取当前会话日志：账本、模型在某次请求看到的内容、上下文对比、上下文压缩移除的内容和按目录价计算的费用。'
icon: https://raw.githubusercontent.com/PerfectPan/estela/main/apps/dsh-plugin/assets/icon.png
```

The description is checked against the code. It must be re-read against the released plugin before the pull request,
and any claim the release does not keep is removed.

### C. Rejected options

- An iframe of Estela's own loopback port (the phase 0 design): a second server, a one-time code, and a URL that
  could reach the session log. Replaced by the research of 2026-11-19.
- `@rivus/estela-dsh-plugin` as the package name: breaks the `dsh-<name>` pattern of the list (T1).
- A public `@rivus/estela/server` and `/embed` entry: dropped by D3.
- Tree-shaking DevFrame out of `@rivus/estela-server` instead of a `core` entry: depends on the bundler and cannot be
  linted (T6).
- Throwing when a second server binds: there is nothing left to bind (T5).
- The plain `ctx.connection.rpc.handle(...)` on rc.5: the plugin does not activate (T11).
- A route the plugin registers itself: it works on rc.5 and answers 400 on alpha.2, and its disposer is not bound to
  the plugin (T11).
- `engines.dsh` from rc.1: rc.1 to rc.4 were not run (T11, T20).
- A polled progress endpoint: a few updates per load at most, and polling was not measured (T10).
- `CSS.registerProperty` instead of a `<style>`: same pixels, more code (T19).
- Webfonts in the embed, with a prefix on the family names: about 120 kB gzip on every dsh page load, and a name in the
  host page's font namespace (T19).
- A second file loaded when the View first opens: dsh's loader for it was not verified (T18).
- A `/estela` command in the first version: no interface on rc.5 selects a View from a command. Adding one later is an
  addition (T16).
- A session browser and an entry for blank sessions in the first version: an unverified entry point and a second
  screen (T15).
- A `fixed` changesets group for the CLI and the plugin: the plugin's version would follow CLI releases that do not
  change it, and a dsh-driven plugin release would bump the CLI.
- dsh as a workspace devDependency for the smoke test: 1.3 GB in every install (T21).
