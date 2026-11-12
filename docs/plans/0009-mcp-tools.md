# Plan 0009: MCP tools to inspect earlier sessions

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-11-13
- Paired Spec: [`docs/specs/0009-mcp-tools.md`](../specs/0009-mcp-tools.md)

This plan builds the agent tools of Spec 0009 in `packages/server`, registers them in the definition's `setup`, makes
`estela mcp` serve the session catalog without a path, and turns the dev server's HTTP MCP route off by default. It
is stacked on plan 0006 (`createEstelaServer`, PR #115).

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Verification
5. Execution plan
6. Risks, open questions, and follow-up

## 1. Background and goals

### 1.1 Current behavior and constraints

- DevFrame 1.1.0 (`devframe`, `@devframes/agentic`, as installed in this worktree) derives MCP tools from RPC
  functions that carry an `agent` field. Their input schema comes from the RPC's `args` (positional Standard
  Schemas); `args` would advertise `arg0` (devframe#420), so Estela's handlers parse their own input and
  `estela_reconstruct` is listed with `{ type: "object", properties: {} }`. The RPC `agent` options have no
  `inputSchema`.
- A tool registered through `ctx.agent.registerTool` may carry a raw `inputSchema`; the MCP adapter's `projectTool`
  uses it before computing one (`tool.inputSchema ?? computeInputSchema(tool, ctx)`). Ids are mapped to wire names
  by `toAgentToolName` (`estela:reconstruct` → `estela_reconstruct`). `registerTool` throws `DF0015` when an RPC with
  `agent` has the same id.
- The adapter replies with `stringifyForMcp(result)`: a string passes through, anything else is
  `JSON.stringify(value, …, 2)`. `structuredContent` is sent only with an output schema.
- `TraceStore.reconstruct` returns the kernel result without `present`, unlike `view` and `event`, so the MCP result
  is not redacted. Event ids come from the log (Claude Code's `uuid`).
- `createDevServer` with `mcp: undefined` mounts `/__estela/__mcp` once the agent surface is non-empty, with
  `authorization: false`: origin and loopback-peer checks only, not the one-time code that gates the WebSocket.
- `estela mcp` without a path loads the bundled demo trace; it builds the server with `catalog: undefined`.
- The session catalog (`SessionCatalog.listSessions`) serves rows with summary counts, `matches` for a query (FTS5 in
  the index, or the same substring rule in memory), and `first` to summarize rows before others.

### 1.2 Problem

An agent cannot reach an earlier session through MCP, the one tool's schema is empty, its result is not redacted,
and ids from the log pass through verbatim. Adding tools that read every session would widen the unauthenticated HTTP
route from one reconstruct over `current` to the content of every session.

### 1.3 Goals and success criteria

- Seven tools with the names, schemas, results, bounds, and errors of Spec 0009; `tools/list` shows named
  properties for each.
- `estela mcp` without a path serves the catalog; with a path, the five session tools over `current`.
- Every tool result and error is redacted in one place, whatever `ESTELA_REDACT` says.
- S17 and S18 pass on the installed tarball.

### 1.4 Non-goals

- No new RPC for the browser, no change to the browser's RPCs, no write tools, no MCP resources.
- No authorization for the HTTP route beyond turning it off by default (issue #94).
- No change in `@rivus/agent-kit`; no skill in the npm tarball.

## 2. Outline

### 2.1 Design principles

- One parse schema per tool is both the input check and the advertised JSON Schema.
- The tools are a presentation of existing reads (catalog rows, the TraceStore's trace, kernel projections); they add
  no index content and no estimate.
- Redaction and bounds are applied at the tool boundary, after every service, so no service setting can turn them
  off.

### 2.2 Boundaries and responsibilities

| Directory | Owns after this change |
|---|---|
| `packages/server/src/agent-tools/` | tool inputs (`inputs.ts`), bounds (`bounds.ts`), the id alias (`trace-ids.ts`), session lists (`session-list.ts`), summary, turns, and requests (`trace-reads.ts`), event and reconstruct results (`event-read.ts`), registration with redaction (`register.ts`) |
| `packages/server/src/composition/` | calls `registerAgentTools(ctx.agent, …)` at the end of `setup` in `dev` mode |
| `packages/rpc` | `TraceStore.withTrace` (a read over the loaded trace) and `reconstruct` presented; the `reconstruct` RPC loses its `agent` field |
| `packages/kernel` | `capStrings`, the view's string cap for one value |
| `apps/cli` | `mcp` without a path builds the catalog; `--mcp` default off; help texts |
| `skills/estela/` | the agent skill, kept in the repository |

### 2.3 Main path

```text
MCP client --stdio--> createMcpServer(definition)            (estela mcp)
                      setup: openLaunch | catalog.start, bind services,
                             registerAgentTools(ctx.agent, { store, catalog, home })
tools/list  -> ctx.agent.list() -> inputSchema from inputs.ts (z.toJSONSchema)
tools/call  -> handler: parseToolInput -> run -> redact -> JSON.stringify (compact)
   list/search  -> catalog.listSessions({ query?, first? }) -> filter -> pageWithin
   summary/turns/requests -> store.withTrace(traceId, trace -> kernel projections)
   get_event    -> store.withTrace (resolve id) -> store.event -> capStrings, fit
   reconstruct  -> store.withTrace(trace -> kernel reconstruct) -> last ids, fit
```

### 2.4 Design decisions

| ID | Decision | Alternatives and reason |
|---|---|---|
| D1 | Register tools with `ctx.agent.registerTool` and a raw `inputSchema` built by `z.toJSONSchema(schema, { io: 'input' })` from the `zod/mini` schema that parses the input. | RPC `args` advertises `arg0` (devframe#420). A hand-written JSON Schema beside a parse schema can drift. A Standard Schema in `args` is also positional. |
| D2 | Tool ids `estela:<snake_name>`; the wire names are `estela_<snake_name>`, so `estela_reconstruct` keeps its name. The `reconstruct` RPC stays for DevFrame clients but loses `agent`. | Keeping `agent` on the RPC collides with the registered id (`DF0015`). Kebab names would put `-` in the wire name, unlike the existing tool and common MCP style. |
| D3 | The tools live in `packages/server`, not `packages/rpc`. | They redact with the kit at runtime and read the catalog; `packages/rpc` may use the kit's types only and must stay browser-bundleable. |
| D4 | Redact every result and error message in `register.ts` with the kit's `redact`/`redactText` and the platform's home, after the services; every recorded string is redacted before it is cut (`shown` in `bounds.ts`), and the catalog is asked to redact before it shortens a prompt (`listSessions(query, redact)`). The kit cuts titles (80) and first prompts (500) before redaction, so for those fields `trimCutHome` replaces a trailing partial home path with `~`; it goes away when the kit cuts after redacting. | Relying on the store's `present` and the catalog's `ESTELA_REDACT` check leaves the dev server's route unredacted with `ESTELA_REDACT=0`. Redaction is idempotent, so a result the store already redacted is unchanged. |
| D5 | Unsafe event and lane ids are shown as `@e<seq>` / `@l<n>` and accepted back; content stays as recorded. | Cutting or redacting an id breaks the next call. Hashing ids makes every id opaque and costs the agent the recorded ids it may see in content. The safe alphabet excludes `@`, so an alias never collides with a recorded id. |
| D6 | Results are returned as compact JSON text. | The adapter pretty-prints objects with two spaces, about a third larger than the bound measures; a string passes through. No output schema, so no `structuredContent`: an output schema would be one more interface to pin before the result shapes have users. |
| D7 | A 40,000-character bound per result; list pages end early at the bound with `nextOffset`; offsets, not cursors. | Claude Code warns above 10,000 tokens of tool output. An opaque cursor adds state; the list is ordered by activity and an agent re-reads from offset 0 when it needs a fresh view. |
| D8 | `estela_get_event` caps strings with the kernel's view capper (`capStrings`) after redaction, and lowers the cap in steps of 0.75 to 256, then leaves out `original`, then `payload`. | Capping before redaction could cut a home path short of the redaction pattern. The same paths format as the view's `$truncated` keeps one convention. |
| D9 | `estela_reconstruct` keeps the last 100 ids per list with totals. | The last ids are nearest the event; the turn and request tools reach earlier events. A paged reconstruct adds inputs for a rare need. |
| D10 | Flag filters ask the catalog to summarize the untested sessions first (`first`) and wait up to 5 s; the rest are counted in `unsummarized`. | Without the wait, a first `estela mcp` on a cold index answers "no sessions" while summaries run (seen in the manual walk). A longer or unbounded wait blocks the client. |
| D11 | `estela mcp` without a path and without `ESTELA_PATH` serves the catalog; with a path it keeps the one-session server and registers no list tools. | Serving the catalog plus the path would change `current` semantics for existing users; the demo trace is no use to an agent. |
| D12 | The dev server mounts the HTTP MCP route only with `--mcp`, and the help says the one-time code does not gate it. | The tools expose every session's content; the route's origin and loopback checks do not stop another local user or process. A bearer token is the fix (#94) but needs a way to hand it to clients. |
| D13 | `exposeSharedState: false` for `estela mcp`. | DevFrame's `devframe_state_read` tool would expose the browser's `{ revision, pending }` signal, which tells an agent nothing. |
| D14 | The skill stays in the repository (`skills/estela/SKILL.md`) and the README says how to install it. | Shipping it means copying it into `apps/cli` at pack time and changing the tarball's file list check; the package is not published yet. |

## 3. Detailed design

### 3.1 Interfaces

```ts
// packages/server/src/agent-tools/register.ts
export interface AgentToolDeps {
  store: TraceStore
  catalog: SessionSource | undefined // { listSessions(query): Promise<ListSessionsResult> }
  home: string
}
export function registerAgentTools(host: Pick<DevframeAgentHost, 'registerTool'>, deps: AgentToolDeps): string[]

// packages/rpc/src/trace-store.ts
class TraceStore {
  withTrace<T>(traceId: string, read: (trace: Trace) => T): Promise<T> // own hold, errors scrubbed
  reconstruct(traceId: string, eventId: string, owner?: object): Promise<ReconstructResult> // now presented
}

// packages/kernel/src/view.ts
export function capStrings(value: unknown, max: number): { value: unknown; truncated: TruncatedPath[] }

// packages/server/src/composition/definition.ts
export function defineEstela(app: EstelaApp, services: (ctx: DevframeNodeContext) => Promise<void>): DevframeDefinition
```

### 3.2 Setup and lifecycle

- `setup` in `dev` mode: as plan 0006, then `registerAgentTools(ctx.agent, { store, catalog, home: platform.home })`.
  Without a catalog the list and search tools are not registered.
- `estela mcp`: with a target, `openLaunch` first (a failure maps to the `session` failure, exit 1); without one,
  `catalog.start()` first (a failure maps to `index`) and an unavailable index is one stderr line. Then
  `createMcpServer(definition, { transport: 'stdio', exposeSharedState: false })`.
- `TraceIds` (the alias map) is cached per loaded trace object in a `WeakMap`, so it lives as long as the store
  keeps the trace.

### 3.3 Failures

Handlers throw; DevFrame's adapter turns a throw into `isError: true` with `Error invoking "<tool>": Error: <message>`.
Input errors are `TypeError`s from `parseToolInput`; store errors keep their messages (`unknown trace id: …`, load
errors) with a hint added to the unknown trace id. Every message is redacted before it leaves the handler.

### 3.4 Compatibility

See the Spec's compatibility section. `apps/cli/test/cli-smoke.test.ts` and S10 keep passing unchanged: the path
form, the tool name, and the `eventId`, `visibleIds`, `unavailable`, `completeness` fields stay.

### 3.5 Security and privacy

- Redaction at the tool boundary (D4); ids aliased (D5); descriptions mark results as data.
- The HTTP route is off by default (D12). With `--mcp` it is reachable by any process on the machine that sends a
  loopback `Origin`; issue #94 owns an authorization for it.
- Results still hold session text and file contents, like a report.

## 4. Verification

- Unit tests beside the code in `packages/server/src/agent-tools/`: inputs (schema shape, errors), bounds (paging),
  trace ids (aliases), session list (filters, flags, the wait, clipping), event read (redact before cut, lowering,
  reconstruct lists). `packages/kernel/src/view.test.ts` covers `capStrings`; `packages/rpc/src/trace-store.test.ts`
  covers `withTrace` and the presented `reconstruct`.
- `packages/server/test/agent-tools.test.ts`: `createEstelaServer` and DevFrame's `createHostContext`, `setup`, then
  `ctx.agent.list()` and `invoke` over a synthetic home with `ESTELA_REDACT=0`: the schemas, the walk, paging, the
  hostile session, and the errors.
- `apps/e2e/src/mcp.smoke.ts`: S17 and S18 over stdio against the installed tarball.
- A manual stdio walk against the built CLI and a manual check of the dev server's route with and without `--mcp`.

## 5. Execution plan

### 5.1 Preconditions

`refactor/server-composition` (PR #115) at `16d7c9a` or later; Node `^26.13.1`; DevFrame 1.1.0.

### 5.2 Completion contract

- Every gate in 5.4 passes.
- `tools/list` from `estela mcp` shows seven tools with named properties; from `estela mcp <path>` five.
- No tool result contains the home directory with `ESTELA_REDACT=0` (S18).

### 5.3 Execution order

#### Task 1: Store and kernel

- Files: `packages/rpc/src/trace-store.ts`, `packages/rpc/src/original-reload.ts`, `packages/rpc/src/functions/trace-view.ts`, `packages/kernel/src/view.ts`, `packages/kernel/src/index.ts`, their tests.
- Change: `withTrace`; `reconstruct` presented; `withoutOriginals` moves to `original-reload.ts` (the store file stays under 500 lines); the RPC drops `agent`; `capStrings`.
- Exit condition: `pnpm test` in `packages/rpc` and `packages/kernel` passes.

#### Task 2: Agent tools

- Files: `packages/server/src/agent-tools/*`, `packages/server/src/composition/{definition,estela-server}.ts`, `packages/server/test/agent-tools.test.ts`.
- Change: 3.1 and 3.2.
- Exit condition: the unit and integration tests pass.

#### Task 3: CLI

- Files: `apps/cli/src/entry/{app,routes}.ts`, `apps/cli/src/entry/commands/{mcp,dev}.ts`.
- Change: `mcp` without a path, `--mcp` default off, help texts.
- Exit condition: `apps/cli` tests pass; the manual walk works.

#### Task 4: Smoke, skill, documents, release intent

- Files: `apps/e2e/src/mcp.smoke.ts`, `skills/estela/SKILL.md`, `scripts/check-conventions.mjs` (`SKILL.md` is a fixed name), `CONTRIBUTING.md`, `AGENTS.md`, `README.md`, `README.zh-CN.md`, `apps/cli/README.md`, `docs/architecture/overview.md`, `docs/development/setup.md`, Spec and Plan 0009 with their Chinese copies, `docs/specs/README.md`, `docs/plans/README.md`, `.changeset/mcp-tools.md` (`minor`).
- Exit condition: every gate in 5.4.

### 5.4 Validation ledger

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| all | `node scripts/check-doc-translations.mjs`, `node scripts/check-conventions.mjs`, `node scripts/check-release-plan.mjs` | ok |
| all | `pnpm install`, `node scripts/format.mjs --check`, `node scripts/lint-scripts.mjs`, `pnpm lint`, `pnpm typecheck` | no errors |
| all | `pnpm build`, then `pnpm test` | all pass |
| all | `node scripts/check-layers.mjs`, `node scripts/check-browser-bundle.mjs` | ok |
| all | `cd apps/e2e && pnpm run test:smoke`, `pnpm run test:e2e` | all pass |
| all | a stdio client walk against `apps/cli/bin.mjs mcp`; `curl` on `/__estela/__mcp` with and without `--mcp` | the walk returns results; the route answers only with `--mcp` |

### 5.5 Rollback per batch

One PR; revert it. The session index layout and the browser's RPCs do not change.

## 6. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| HTTP route without authorization when `--mcp` is given | risk | Another local process can read every session through the route | unconfirmed | Issue #94 |
| Result shapes before users | risk | A shape that proves awkward costs a minor release now, a major one after 1.0 | unconfirmed | Review the shapes with the first agent users before 1.0 |
| The TraceStore keeps 3 traces | risk | A walk across many sessions reloads them; large sessions load slowly | unconfirmed | Revisit if agents walk many sessions |
| `estela mcp --no-index` | follow-up | No way to run the stdio catalog without the index | unconfirmed | Add the toggle when asked |
| An event listing tool, content search, cost, context diff as tools | follow-up | Out of scope here | unconfirmed | Separate issues |
| The kit cuts titles and first prompts before redaction | risk | The browser's session list and the `--pick` labels can show the start of a home path cut at 80 characters; the MCP tools work around it with `trimCutHome` | unconfirmed | Fix in `@rivus/agent-kit` (cut after redacting), then remove `trimCutHome` |
| Ship the skill in the npm package | follow-up | Users copy it from the repository | unconfirmed | When the package is published |
