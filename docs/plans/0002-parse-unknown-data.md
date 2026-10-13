# Parse unknown data with schemas and type event payloads per kind

- Status: accepted; PR A implements 3.1 to 3.4, PR B follows
- Owner: PerfectPan
- Reviewer: unconfirmed
- Last updated: 2026-10-13
- Paired Spec: none (a technical refactor; no user-visible behavior changes)
- Issue: [#39](https://github.com/PerfectPan/agent-trace/issues/39)

agent-trace reads unknown data in many places: event payloads from the kit and from canonical JSON files, RPC inputs from the browser and MCP, SQLite rows, caught errors, DevFrame dump files, and package manifests. Most of these reads use hand-written shape guards (`asRecord`, `asString`, `asNumber`, `typeof` cascades) or casts that check nothing. This plan replaces them: unknown data is parsed once at its boundary with `zod/mini`, or with an es-toolkit predicate where a schema per value is too slow, and code past the boundary reads typed values. It ships as two PRs. PR A parses the inputs at the edges (RPC, the session index, the CLI's files and process APIs) and changes no shared type. PR B types event payloads per kind on top of the kit's typed `TranscriptEvent` and removes the kernel's helpers.

## Contents

1. Background and goals
2. Outline
3. Detailed design
4. Rollout and stability
5. Verification
6. Execution plan
7. Risks, open questions, and follow-up
8. Appendix A: inventory
9. Appendix B: measurements

## 1. Background and goals

### 1.1 Current behavior and constraints

Measured on `main` at `3f100ad` and again at `a0aba04`, after #41 renamed `host` to `agent` and #42 moved the toolchain to Vite+.

- **Event payloads.** `TraceEvent.payload` is `z.record(z.string(), z.unknown())`. The kernel reads it through `asRecord` (lodash `isPlainObject` plus a cast), `asString`, and `asNumber` in `fold`, `lanes`, `project-timeline`, `project-turns`, and `reconstruct`; the web app does the same in `event-text.ts`, `ledger-model.ts`, and the inspector. `prompt-snapshot.ts` casts the payload to `PromptSnapshotPayload` without a check, and `view.ts`'s `Capper.value` walks payloads with lodash `isObjectLike` plus casts.
- **The kit.** Up to 0.11.0, which trace uses today, the kit's `TranscriptEvent.payload` is `Record<string, unknown>`, and its per-kind interfaces are not tied to `kind`. Kit #98, released in 0.12.0 on 2026-10-13, makes `TranscriptEvent` a union discriminated by `kind`: narrowing on `kind` types `payload` as that kind's `*Payload` (`TranscriptEventOf<K>`, `TranscriptEventPayloads`). 0.13.0, released the same day and the version PR B installs, keeps these types and adds only the opencode bridge change of kit #89, which carries the current session id through the bridge. The kit parses agent records with `zod/mini` at its own boundary.
- **RPC inputs.** `list-sessions` (`checkQuery`) and `export-report` (`checkInput`) check their input with `typeof` cascades and casts. `load-trace`, `get-trace-view`, `get-event`, and `reconstruct` destructure their input unchecked. DevFrame types `call()` from the handler signatures (module augmentation in `packages/rpc/src/index.ts`).
- **Stored rows and errors.** `runtime-node` reads SQLite rows through casts, `readNumber`, `String(row.x)`, and `Number(row.x)`; `context_shape` through `typeof` and `every(typeof)`; `errcode` and `EEXIST` through `(error as { … })`. The sqlite warning filter reads `process.emitWarning`'s arguments as `unknown` and casts them.
- **CLI files.** `report-site.ts` casts DevFrame's dump manifest and record, `scripts/third-party-notices.ts` returns `JSON.parse` output as a typed manifest, and `terminal.ts` casts the rest arguments of its `stream.write` wrapper.
- **Libraries.** `zod` 4.6.5 is a dependency of `packages/schema`; es-toolkit 1.52.0 is in the lockfile through the kit. The web bundle holds no zod: 286.8 KB raw / 94.6 KB gzip at `3f100ad`.
- **Constraints.** AGENTS.md: missing data is `unavailable`; adapters fail loud and drop no events; session reading is the kit's and only `apps/cli` imports it at runtime; other packages use kit types with `import type` and do not copy them. Error messages that the web app and tests parse stay byte-identical. The MCP smoke test calls `reconstruct` with `arguments: { eventId }`.

### 1.2 Problem

A hand-written guard restates a shape at every read and drifts from the producer: three web reads (`tool_result.text`, `compaction.summary`, `tool_result.durationMs`) read fields that no producer writes. A cast checks nothing, so a malformed RPC input or stored row reaches code that assumes its type. The owner's TypeScript review rules and the kit's authoring rules forbid both forms; a guard is allowed only as one of four exception classes.

### 1.3 Goals and success criteria

- The greps in 5.1 find only the documented exception classes (brand-symbol guards, deep-freeze helpers, narrowing a known union, `WeakSet`/`WeakMap` bookkeeping), each with its reason in a comment, plus test code outside the files a PR touches.
- Behavior is unchanged for well-formed input: existing tests, the CLI smoke suite, and the e2e suite pass; the error messages listed in 3.1 are byte-identical and pinned by tests.
- PR A leaves the web bundle unchanged. PR B records the web build before and after.

### 1.4 Non-goals

- The dependency-free root `scripts/*.mjs` (no install, no types, repository-owned inputs).
- Test and e2e code outside the files a PR touches.
- The wire contract: handler parameter and result types stay as they are.
- DevFrame's `args` option (see D5).
- New behavior for well-formed data.

## 2. Outline

### 2.1 Design principles

- Parse once at the boundary; read typed values after it. A read past the boundary narrows a known union and checks nothing else.
- Trace schemas validate and keep the value: a guard implemented by a schema returns the input itself, so identity and key order survive.
- Every message a client or test parses stays byte-identical.
- The kit owns session reading, so it owns the payload types. Trace adds only its own fields (the view's `$truncated` and snapshot references).

### 2.2 Boundaries and responsibilities

| Boundary | Owner | Parsed with | PR |
|---|---|---|---|
| Agent records → `TranscriptEvent` | kit adapters | kit's `zod/mini` schemas; typed by kind since 0.12.0 | kit #98 |
| Kit `Transcript` → `Trace` | `apps/cli` `transcript-trace.ts` | nothing: the kit's types carry the payload per kind | B |
| Canonical JSON file → `Trace` | `apps/cli` `session.ts` | `isTrace` (schema guard), now including payloads | B |
| `Trace` → view trace | kernel `toView` / `fitView` | `isTrace` once on the chosen view | B |
| Report JSON in `index.html` | web `shell/report.ts` | `isReportTrace` (schema guard) | B |
| RPC inputs (browser, MCP) | rpc handlers | `zod/mini` in each handler | A |
| Original records (`fingerprint`) | rpc `source-check.ts` | es-toolkit `isPlainObject`, `isPrimitive` | A |
| SQLite rows, errors, `emitWarning` arguments | runtime-node | `zod/mini` row schemas; Node's overload types | A |
| Dump files, package manifests, `stream.write` arguments | `apps/cli` | `zod/mini`; `Writable.write`'s overload types | A |

### 2.3 Main path

```text
agent log -- kit adapter (zod/mini) --> TranscriptEvent (typed by kind) --> Trace (same objects, no parse)
canonical JSON file -- JSON.parse --> isTrace (payloads checked) ------------> Trace (typed)
                                          \-- fails: fall through to the kit (unchanged)
Trace -- fitView: draft per cap step --> isTrace once on the chosen view ----> view Trace (typed, memoized)
view Trace -- DevFrame RPC (typed contract) ---------------------------------> web (no re-parse)
report-trace JSON in index.html -- JSON.parse --> isReportTrace ------------> web report mode
RPC inputs (browser, MCP) -- zod/mini parse in handler ----------------------> typed handler input
SQLite rows / errors / warnings / dump files -- zod/mini or typed overloads -> typed values
```

### 2.4 Design decisions

| ID | Decision | Reason |
|---|---|---|
| D1 | `TraceEvent` becomes a union discriminated by `kind`, built from the kit's `TranscriptEventPayloads` (`import type`) plus trace's view fields. `EventOf<K>` names one kind. Readers narrow on `event.kind` (known-union narrowing, an allowed exception). | Parse once, typed afterwards, no cost per read. Typed accessors would re-parse on every read (projections run several times per trace in the browser), cache in a `WeakMap`, or cast, and give no narrowing at call sites. Building on the kit's types keeps one definition of each payload (AGENTS.md: do not copy kit types). |
| D2 | `packages/schema` holds a `zod/mini` schema per kind for the JSON trace reads: `z.looseObject` payloads with the kit's declared fields, undeclared fields kept for the Input tab, `$truncated?` on every payload, `systemPromptSameAs?` and `toolsSameAs?` on `system`. A compile-time check ties each payload schema's output to the kit's payload type. `promptSnapshot()` narrows `kind === 'system'` and compares `type` like the kit's, with no cast. | Canonical files and report JSON are untrusted JSON, so they need a runtime check that the kit's types cannot give. The payload sweep (Appendix B) found 9 undeclared keys on `system` and 3 on `hook` that the inspector shows today. |
| D3 | Trace schemas are pure validators (no defaults, `catch`, or transforms). Callers keep the validated input through schema guards (`isTrace`, `isTraceEvent`), not `.data`. | zod's output reorders keys (shape first, then extras) and copies every payload shell. A guard keeps identity and key order, so the Input and Output tabs and `toEqual` of the canonical fixture stay byte-identical, at the same cost. |
| D4 | Parsing points: (a) the canonical fast path `isTrace` checks payloads, and a failing file still falls through to the kit; (b) `transcriptToTrace` maps the kit's typed events without a parse or a cast; (c) `toView` / `fitView` check the final view once, not per `fitView` step; (d) report mode guards `<script id="report-trace">`. Live RPC results are not re-parsed. | (b) The kit parses at its boundary and its types since 0.12.0 tie each payload to its kind, so a second parse would only repeat it (see D10). (c) `Capper.value` returns `unknown`. (d) `JSON.parse` output. RPC: both ends ship in one tarball, and the server checked the value at (a), (b), or (c). |
| D5 | RPC inputs are parsed inside each handler with `zod/mini`; the `error` param on every check carries today's message, and the first issue's message is thrown with today's error class. The four handlers that took `{ ref }`, `{ ref, id }`, or `{ ref?, eventId }` unchecked get schemas too. The handler parameter type stays the client contract. DevFrame's `args` option is not used. | DevFrame `args` validates guard-only and advertises positional `arg0` on the MCP surface: `reconstruct` would then expect `{ arg0: { eventId } }` and break the MCP calls the smoke tests pin. It would also wrap messages in DF0043 and cannot normalize (`null` → `{}`, a lenient `locale`). |
| D6 | Generic hot walks over arbitrary JSON (`fingerprint`, `Capper.value`) use es-toolkit's `isPlainObject` and `isPrimitive` (type guards), then known-union `typeof` tests; per-node zod is too slow there. Single values (errors, RPC inputs, rows, display arguments) use `zod/mini`. The kernel drops lodash-es. | `fingerprint` over 81k originals: es-toolkit form within 2% of the hand-written form; a zod schema per value was 2.7 times slower (Appendix B). The same hashes in every form. |
| D7 | SQLite rows are parsed with one `zod/mini` row schema per SELECT (`z.nullable` for nullable columns); `HEAD_SELECT` and `SUMMARY_SELECT` are built from the schemas' keys. The index is a cache: a row whose head does not parse is deleted, with its prompts and search row, by `rows` or by the `writeHead` that finds it, and the next discover pass writes it again; a summary that does not parse is not served by `get`. `context_shape` is `JSON.parse` in `try`, then `z.array(z.number())`; a damaged shape loses only the shape. `errcode` and `EEXIST` are read through `z.object` schemas, `errcode` through one `sqliteErrcode`. | Stored records are in the rule's input list; `node:sqlite` types rows as `Record<string, SQLOutputValue>`, and the casts narrowed that without a check. |
| D8 | zod/mini enters the web bundle in PR B: at most +39.3 KB raw / +9.5 KB gzip at `3f100ad` (trace and report schemas and parse), re-measured on the Vite+ build in PR B. No size budget is set. | The report guard parses JSON in the browser, and importing any value from the schema module already pulls 6.3 KB gzip (top-level schema construction is not tree-shaken). The owner accepted it. |
| D9 | Two PRs: PR A (inputs at the edges, no shared type changes), then PR B (typed payloads end to end). No compatibility shims. | Deleting the kernel helpers and changing `TraceEvent` breaks the web app's compile until its readers change, so PR B is one PR; PR A is independent of it. |
| D10 | Kit first: the kit typed its payloads by kind (kit #98, since 0.12.0) before trace does. PR B moves trace to kit 0.13.0, builds `TraceEvent` on `TranscriptEventPayloads`, and drops the per-event guard in `transcriptToTrace` that this design first planned. `packages/schema` gets a type-only dependency on the kit, like the other packages. | The guard existed only because the kit's payload type was loose. With the kit's union, a guard would re-check every kit event at load (about 2 µs each, Appendix B) for nothing, and a load error on a mismatched kit payload, which the first draft of this design accepted as a risk, cannot happen without a kit type error first. |

## 3. Detailed design

### 3.1 RPC inputs (PR A)

`packages/rpc/src/functions/parse-input.ts` holds `parseInput(schema, input, ErrorType = TypeError)`: `z.safeParse`, then throw `ErrorType` with the first issue's message. Every schema passed to it sets `error` on each check, so that message is the whole message. zod's object parse reports issues in shape order, which is the order the hand-written checks ran in. Each handler keeps its parameter type and parses `input` before anything else reads it.

| Handler | Input | Message for a malformed input | Class |
|---|---|---|---|
| `list-sessions` | not an object (`null` and `undefined` read as `{}`) | `list-sessions: expected an object` | `TypeError` |
| `list-sessions` | `query` not a string of at most 1000 characters | `list-sessions: query must be a string of at most 1000 characters` | `TypeError` |
| `list-sessions` | `since` not a non-negative integer | `list-sessions: since must be a non-negative integer` | `TypeError` |
| `list-sessions` | `first` not an array of at most 500 strings | `list-sessions: first must be an array of at most 500 refs` | `TypeError` |
| `export-report` | no non-empty string `ref` | `export-report needs a session ref` | `Error` |
| `load-trace` | no string `ref` | `load-trace needs a session ref` (new) | `TypeError` |
| `get-trace-view` | no string `ref` | `get-trace-view needs a session ref` (new) | `TypeError` |
| `get-event` | not an object / no string `ref` / no string `id` | `get-event needs a session ref and an event id` / `get-event needs a session ref` / `get-event needs an event id` (new) | `TypeError` |
| `reconstruct` | not an object or no string `eventId` / `ref` neither a string nor `null` nor absent | `reconstruct needs an event id` / `reconstruct: ref must be a string; leave it out for the current session` (new) | `TypeError` |

The first five rows are today's messages and classes. A string `ref` still reaches the store unchanged, so `unknown session ref: …`, `no event … in …`, and `load of … was cancelled` stay as they are. `export-report` ignores a locale other than `en` and `zh-CN`, as before. `since` uses `z.int()`, the safe-integer range, slightly narrower than `Number.isInteger`; revisions count up from 0 and never get near 2^53.

### 3.2 Generic JSON walks

`fingerprint` (PR A) tests the record with `isPlainObject` and each top-level value with `isPrimitive`, then narrows the known primitive union with `typeof`. Originals come from `JSON.parse`, so every record is a plain object and the hashes are unchanged. `Capper.value` (PR B) keeps its shape (string, array, record, other) with `Array.isArray` and `isPlainObject` as the container tests. The only difference from `isObjectLike` is that a non-plain object (class instance, `Date`, `Map`) is no longer walked; payload values come from `JSON.parse` or object literals, so none exists. `toView` builds a draft whose session and events are `unknown` to the type system and returns it through `isTrace`; `fitView` measures drafts per cap step and checks only the chosen one. A failed check throws: capping turns strings into strings and renames only keys longer than the cap, which no declared key is.

### 3.3 Session index rows and errors (PR A)

```ts
const textColumn = z.nullable(z.string())
const numberColumn = z.nullable(z.number())
const headRow = z.object({
  ref: z.string(), agent: z.string(), path: z.string(), size: z.number(), mtime: z.number(),
  session_id: textColumn, title: textColumn, cwd: textColumn, first_prompt: textColumn,
  started_at: numberColumn, last_active_at: numberColumn,
})
const summaryRow = z.object({
  summary_version: numberColumn, turns: numberColumn, requests: numberColumn, tokens_in: numberColumn,
  tokens_out: numberColumn, duration_ms: numberColumn, compactions: numberColumn, subagents: numberColumn,
  failed_tools: numberColumn, context_shape: textColumn,
})
const HEAD_SELECT = Object.keys(headRow.shape).join(', ')
```

`rows` parses each row with `headRow` and `summaryRow` separately: a bad head deletes the row, a bad summary drops only the summary. `rows` and `writeHead` also select `id`, and the delete matches prompts through the stored `ref` in SQL, so a row whose `ref` does not parse loses its prompts too. `rows` deletes in a write transaction that begins after its read, so inside that transaction it re-reads each such row by `id` and deletes it only if its head still does not parse: in between, another process's `writeHead` may have written a valid row under the same `id`. The delete is optional: when it fails for any reason (busy, full, read-only, I/O), `rows` still returns the rows it read, and the row stays hidden for `writeHead` to delete. The smaller SELECTs (`id`; `ref`; `text`) have their own row schemas; a search or prompt row that does not parse is left out. `PRAGMA user_version` and `count(*)` go through row schemas too; a version that does not parse reads as 0, so `prepare` creates the schema in an empty file or rebuilds the file. `sqliteErrcode(error)` is `z.safeParse(z.object({ errcode: z.number() }), error).data?.errcode`, used by the open path (exact codes) and by search (extended codes masked with `0xff`). `EEXIST` on the rebuild lock is `z.object({ code: z.literal('EEXIST') })`.

### 3.4 CLI files and process APIs (PR A)

- `report.ts`: `reserveDir` reads `EEXIST` through the same `z.object({ code: z.literal('EEXIST') })` (a one-line schema in each package, not a shared export).
- `report-site.ts`: the dump manifest schema reads only the `agent-trace:report-trace` entry (`records`, `fallback`); the record schema is a union of an error record (`error.message`) and an output record (`output`, `unknown` but present, embedded as it is); DevFrame writes a failed call with `error` and no `output`. A manifest that does not parse means "no record", with the existing message.
- `terminal.ts`: the `stream.write` wrapper types its rest arguments as `Writable.write`'s two overload tails (`[callback?]` or `[encoding, callback?]`, where Node also accepts a `null` or `undefined` encoding) and narrows them as a known union, with no cast on the wrapper or its arguments: the callback is the function in either slot, and only a string is an encoding. A decoded binary chunk passes on only the callback, as before.
- `scripts/third-party-notices.ts`: a `z.object` manifest schema (`name`, `version`, `dependencies`, `optionalDependencies`, `bundledVersions`); `license` is read with `z.string()` on its own, so the older object form still reads as "see package". A manifest that does not parse fails the build with the package path and the first issue.
- `runtime-node/suppress-sqlite-warning.ts`: the arguments are typed after Node's `emitWarning` overloads (`[warning: string | Error, typeOrOptions?: string | EmitWarningOptions | Function, ...rest]`); the type comes from an `Error` warning's `name`, else from the string or options argument. The kit's `platform-node/src/sqlite.ts` (0.13.0) has the same filter, but it is private to the kit's own `loadSqlite`, wraps only the kit's `getBuiltinModule` call, and matches the type argument only. Trace's filter must be installed before `bin.mjs` links the module graph that imports `node:sqlite`, and runtime-node may not import the kit at runtime, so trace keeps its own copy.

### 3.5 Event payloads (PR B)

- **Types.** `TraceEvent` is `{ [K in EventKind]: TraceEventBase<K> & { payload: TranscriptEventPayloads[K] & ViewFields<K> } }[EventKind]`, where `ViewFields` adds `$truncated?` to every kind and `systemPromptSameAs?` and `toolsSameAs?` to `system`. `EVENT_KINDS` and the kit's `TRANSCRIPT_EVENT_KINDS` name the same kinds (compile-time check). Exported payload types become aliases of the kit's (`ToolCallPayload`, `SystemPayload`, …) plus their view fields; `PromptSnapshotPayload` is the kit's type plus the `system` view fields.
- **Schemas.** `traceEventSchema` is `z.discriminatedUnion('kind', …)`, one member per kind, each payload a `z.looseObject` over the kit's declared fields (sketch below); `isTraceEvent` and `isTrace` are schema guards (D3). The compile-time check asserts that `z.output` of each payload schema is assignable to the kit's payload type for that kind plus `ViewFields`.
- **Mapping.** `transcriptToTrace` assigns the kit's events to `Trace.events` without a copy, a parse, or a cast.
- **Kernel.** `asRecord`, `asString`, and `asNumber` go; readers narrow on `kind` (`event.kind === 'request' ? event.payload.usage?.inputTokens : undefined`). `promptSnapshot` returns the `system` payload when `type === 'prompt_snapshot'`, with no cast. `view.ts` per 3.2; lodash-es leaves the kernel and es-toolkit joins it.
- **Web.** Readers narrow on `kind`; `numberField` goes. The three reads of fields no producer writes go. `toolTarget` parses its one argument with display schemas (`z.union([z.string(), z.record(z.string(), z.unknown())])`, per key `z.union([z.string(), z.array(z.string())])`). `messageOf(error)` is `z.safeParse(z.object({ message: z.string() }), error).data?.message ?? String(error)` and replaces the inspector's `(x.error as Error | undefined)?.message`. Report mode guards its JSON with `isReportTrace` (trace schema, the summary checked against the kit's `SessionSummary`, event details) and throws with the first issue. `load-session.ts` gets a seam with three typed methods (`loadTrace`, `traceView`, `event`) instead of casting `call`.
- **Generator.** `scripts/generate-trace.mjs` writes `type` on hooks, which the hook schema requires.

```ts
const viewFields = { $truncated: z.optional(z.array(truncatedPathSchema)) }

export const toolCallPayloadSchema = z.looseObject({
  callId: z.string(),
  name: z.string(),
  title: z.optional(z.string()),
  args: z.optional(z.unknown()),
  ...viewFields,
})
// message (user, assistant), reasoning, tool_result, request (usage typed, usageByModel typed),
// system (snapshot fields and *SameAs optional), compaction, hook (type required), unknown (type required): same pattern.

export const traceEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...eventFields, kind: z.literal('user'), payload: messagePayloadSchema }),
  // one member per EVENT_KINDS entry
])

/** Schema guard: callers keep `value` itself (identity and key order unchanged). */
export function isTraceEvent(value: unknown): value is TraceEvent {
  return z.safeParse(traceEventSchema, value).success
}
```

### 3.6 Compatibility and failures

- Well-formed input behaves as before in both PRs. Malformed input that used to slip through now gets a message: a `reconstruct` call without `eventId` used to return `completeness: 'unavailable'` for `eventId: undefined` and now throws `reconstruct needs an event id`; `list-sessions` refuses a `since` beyond 2^53. A baked `report-trace` record with neither `output` nor `error` already failed the build, with a `TypeError` at `jsonSafe(undefined).replaceAll`; only the message is new: `… is not an output or an error`. `report-trace` is baked as a snapshot dump, where a handler that throws fails the build before any record is written, so for it the error-record branch is a safeguard.
- A stored index row with a value of the wrong type (only a damaged or hand-edited cache has one) used to read with that field missing; now the summary is not served, or a row with a bad head is deleted, and the next discover or summary pass rewrites it.
- PR B: a canonical file whose payloads do not match their kind (for example a hook without `type`, which only the old `generate-trace.mjs` wrote) fails `isTrace` and falls through to the kit, as any non-trace JSON does. No compatibility shim: nothing is released.

## 4. Rollout and stability

### 4.1 Gates and rollout stages

Nothing is published. Each PR carries a Rush change file of type `none` (no user-visible change) and merges after the gates in 6.4.

### 4.2 Rollback

Revert the PR. Neither PR changes the index layout or any stored format, so a revert needs no data migration.

## 5. Verification

### 5.1 Functional checks

Done-when greps, expected to find only the exception classes (each with its comment), PR B's sites while PR A is merged alone, and test code outside touched files:

```sh
git grep -nE "asRecord|asString|asNumber|isRecord|plainRecord|readNumber" -- apps packages
git grep -nE "typeof [^=]*(===|!==) ?[\"']object[\"']|instanceof Object|Object\([^)]*\) ===|isObjectLike" -- apps packages
git grep -nE "as unknown as|as Record<string, ?unknown>|error as \{|JSON\.parse\([^;]*\) as [A-Z{]" -- apps packages ':!*.test.ts' ':!apps/e2e' ':!packages/rpc/testing'
```

Tests that pin behavior: kernel `fold`, `projections`, `reconstruct`, `view`, `view-snapshots`; cli `session-conformance`, `session-view`, `session.test` (canonical fixture `toEqual` the file), catalog and index tests; rpc trace-store tests; web `ledger-model`, `load-session`.

New in PR A:

- rpc `handler-input.test.ts`: every message and error class in 3.1, `null` / `undefined` / unknown keys for `list-sessions`, the ignored locale, a string ref passed through to the store, and `reconstruct` without a ref or with `ref: null`. The `list-sessions` and `export-report` cases also pass against the hand-written checks they replace.
- runtime-node: NULL head columns read as absent fields; a damaged `context_shape` loses only the shape; a non-number count loses the cached summary; a bad head deletes the row with its prompts and search row (from `rows`, or from a `putHeads` that finds it under a new ref) until `putHeads` rewrites it; `rows` keeps a row that another index rewrote under the same `id` between its read and its delete, and returns the rows it read when the delete fails with an error other than busy; `sqliteErrcode` reads `SQLITE_BUSY` (5) off a real `node:sqlite` error. The warning-filter test runs unchanged against the typed signature.

New in PR B:

- schema: each kind accepts the kit's shape and keeps extra keys; rejects `tool_call` without `callId`, `hook` without `type`, a non-number `usage.inputTokens`; accepts `$truncated` and the `*SameAs` fields; `isTrace` rejects a bad payload; the guard returns the same object.
- web: the report guard rejects a malformed report; `messageOf` (`Error`, `{ message }`, other); `toolTarget` (string, record with `command`, argv array, other → JSON preview).
- Differential evidence (a scratch script): for every fixture and the local sessions of the sweep, the old tree and the new tree deep-equal on `fold`, `projectLanes`, `projectTurns`, `reconstruct` at each `request` event, `fitView` output, and the web's `rowText` / `inputText` / `outputText` per event.

### 5.2 End-to-end acceptance

The CLI smoke suite (S2, S10 with the MCP `reconstruct { eventId }` call, S13, S15, S16) and the e2e suite (S8 generated canonical trace, S12 350 MiB) pass on the packed tarball, with `AGENT_TRACE_E2E_CHANNEL=chrome`.

## 6. Execution plan

### 6.1 Preconditions

- PR A: `main` at `a0aba04` or later (agent rename and Vite+ merged).
- PR B: PR A merged. `@rivus/agent-kit` 0.13.0 installs at once: the kit is in `minimumReleaseAgeExclude` (`common/config/rush/pnpm-config.json`).

### 6.2 Completion contract

- PR A: tasks A1 to A5 done; the greps in 5.1 find no site in rpc, runtime-node, or `apps/cli` outside the exception classes; the gates in 6.4 pass; `check-browser-bundle` passes with zod and es-toolkit bundled into rpc; the web build is unchanged.
- PR B: tasks B1 to B6 done; the greps find only the exception classes; the differential evidence shows no difference; the web build line before and after is recorded in the PR; this plan is deleted after its lasting constraints move into AGENTS.md and `docs/architecture/overview.md`.

### 6.3 Execution order

#### Task A1: dependencies

- Files: `packages/rpc/package.json`, `packages/runtime-node/package.json`, `apps/cli/package.json`, `common/config/rush/pnpm-lock.yaml`.
- Change: `zod` 4.6.5 (as in `packages/schema`) to rpc and runtime-node (`dependencies`) and `apps/cli` (`devDependencies`, bundled); es-toolkit 1.52.0 to rpc. Rush update. `check-layers` constrains only `@rivus/*` packages, so it needs no change.
- Tests: none.
- Exit condition: `rush install` is clean; the lockfile adds only these importer entries.

#### Task A2: rpc

- Files: `packages/rpc/src/functions/{parse-input,list-sessions,report,trace-view}.ts`, `packages/rpc/src/report.ts`, `packages/rpc/src/source-check.ts`, `packages/rpc/src/functions/handler-input.test.ts`.
- Change: 3.1 and the `fingerprint` part of 3.2; `ReportLocale` comes from a `REPORT_LOCALES` list that the locale schema reuses.
- Tests: `handler-input.test.ts` (5.1).
- Exit condition: rpc tests pass; the `list-sessions` and `export-report` cases also pass against the old handlers.

#### Task A3: runtime-node

- Files: `packages/runtime-node/src/{session-index,session-index-schema,suppress-sqlite-warning}.ts`, `packages/runtime-node/src/session-index.test.ts`.
- Change: 3.3 and the warning filter in 3.4.
- Tests: 5.1.
- Exit condition: runtime-node tests pass, including the multi-process tests that load `session-index.ts` with Node's type stripping.

#### Task A4: CLI

- Files: `apps/cli/src/{report,report-site,terminal}.ts`, `apps/cli/scripts/third-party-notices.ts`.
- Change: 3.4.
- Tests: the existing `terminal`, `report-site`, and build tests.
- Exit condition: `rush build` writes `THIRD-PARTY-NOTICES.txt` as before; the report-site test passes.

#### Task A5: rule and plan

- Files: `AGENTS.md`, root `vite.config.ts` (the comment on `typescript/no-unsafe-type-assertion`), `docs/plans/0002-parse-unknown-data.md`, `docs/plans/0002-parse-unknown-data.zh-CN.md`, `docs/plans/README.md`, a Rush change file of type `none`.
- Change: the AGENTS.md rule (parse unknown data at the boundary; the four exception classes); this plan and its reading copy.
- Tests: `check-doc-translations`.
- Exit condition: the gates in 6.4 pass.

#### Task B1: kit 0.13.0 and the schema layer

- Files: every `package.json` that lists `@rivus/agent-kit`, `packages/schema/package.json`, `scripts/check-layers.mjs`, `AGENTS.md` (layer table), `docs/plans/0001-external-release.md` 2.2.
- Change: kit 0.13.0; `packages/schema` may depend on the kit for types (`import type` only, which the lint rule already enforces outside `apps/cli`).
- Tests: existing suites on the new kit.
- Exit condition: `rush install`, typecheck, and tests pass; `check-layers` passes.

#### Task B2: schema

- Files: `packages/schema/src/{types,index}.ts` and its tests.
- Change: 3.5 types and schemas; the comment that says a trace is not rejected for payload content is rewritten.
- Tests: schema tests in 5.1.
- Exit condition: schema tests pass; the kernel and web compile errors that follow are the readers B4 and B5 change.

#### Task B3: CLI mapping and generator

- Files: `apps/cli/src/transcript-trace.ts`, `scripts/generate-trace.mjs`.
- Change: the mapping in 3.5; hooks get `type`.
- Tests: `session-conformance`, `session.test`.
- Exit condition: cli tests pass.

#### Task B4: kernel

- Files: `packages/kernel/src/{jsonl,index,fold,lanes,project-timeline,project-turns,reconstruct,prompt-snapshot,view}.ts`, `packages/kernel/package.json`.
- Change: 3.5 kernel and 3.2 `Capper.value`; lodash-es out, es-toolkit in.
- Tests: kernel suites; test event builders go through `traceEventSchema` types.
- Exit condition: kernel tests pass.

#### Task B5: web

- Files: `apps/web/src/lib/{event-text,ledger-model,error-message,tab-text,preview}.ts`, the inspector, ledger, and turn-header components, `apps/web/src/shell/report.ts`, `apps/web/src/workspace/load-session.ts`, `apps/web/package.json`.
- Change: 3.5 web.
- Tests: web tests in 5.1.
- Exit condition: web tests pass; the build line before and after is recorded.

#### Task B6: docs

- Files: `docs/architecture/overview.md`, `AGENTS.md`, this plan and its reading copy.
- Change: the overview states typed payloads, where parsing happens, and zod in the web bundle; AGENTS.md drops the pointer to PR B; this plan is deleted.
- Tests: `check-doc-translations`.
- Exit condition: the gates in 6.4 pass.

### 6.4 Validation ledger

| Batch | Command or evidence | Expected result |
| --- | --- | --- |
| A, B | `node scripts/format.mjs --check`, `node scripts/lint-scripts.mjs` | exit 0 |
| A, B | `rush lint`, `rush typecheck`, `rush test`, `rush build` | exit 0 |
| A, B | `node scripts/check-layers.mjs`, `node scripts/check-browser-bundle.mjs` | exit 0 |
| A, B | `node scripts/check-conventions.mjs`, `node scripts/check-doc-translations.mjs` | exit 0 |
| A, B | `node scripts/release-intent.mjs check --base "$(git merge-base HEAD origin/main)"`, `rush change --verify` | exit 0 |
| A, B | `gh repo-checks repository` | exit 0 |
| A, B | `test:smoke`, `test:e2e` with `AGENT_TRACE_E2E_CHANNEL=chrome` | exit 0 |
| A | `handler-input.test.ts` against the old `list-sessions.ts` and `report.ts` | the `list-sessions` and `export-report` cases pass |
| A | web build output | byte-identical to `main` |
| B | differential script, payload sweep rerun, web build line | no difference; 0 sweep failures; before/after recorded |

### 6.5 Rollback per batch

Each PR reverts on its own. Reverting PR A after PR B is merged also reverts `fingerprint` and the RPC schemas, which PR B does not depend on.

## 7. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step or deadline |
| --- | --- | --- | --- | --- |
| Web gzip +9.5 KB (+10%) with no budget | risk | bundle size | owner | PR B records before and after |
| Test churn: about 17 test files build `TraceEvent` literals with arbitrary payloads | risk | PR B size; may expose fixtures that never matched the kit's shapes | PR B | builders move to the typed event shape |
| A declared payload field the kit later changes type of | risk | a canonical file stops passing `isTrace` and falls through to the kit | PR B | the compile-time check fails first on a kit bump |
| `typescript/no-unsafe-type-assertion` stays off | follow-up | casts outside unknown data (DOM, library types, test doubles) are not linted | unconfirmed | revisit after PR B |

## 8. Appendix A: inventory

Class: **V** violation, **R** payload read that becomes typed, **E** allowed exception (a comment at the site names the class), **K** kept, outside the rule (reason given), **T** test code. Sites are named by file and symbol.

| Site | Today | Class | Change | PR |
|---|---|---|---|---|
| kernel `jsonl.ts`, `index.ts` | `asRecord` (lodash `isPlainObject` plus a cast), `asString`, `asNumber` | V | Delete; the kernel drops lodash-es | B |
| kernel `fold.ts` | `asNumber(asRecord(usage)?.[f])`, `durationMs`, `isError === true` | R | Narrow `kind === 'request' / 'system' / 'tool_result'` | B |
| kernel `lanes.ts` | `isPrompt` flags on a loose payload; `requestUsage` through the helpers | R | Typed flags; `event.payload.usage?.inputTokens` | B |
| kernel `project-timeline.ts` | helpers on model, durationMs, callId, name, trigger, pre/postTokens | R | Narrowed reads | B |
| kernel `project-turns.ts` | `asNumber` durationMs | R | Narrowed reads | B |
| kernel `reconstruct.ts` | `asString` summaryEventId, `compactSummary === true`, `asNumber` postTokens | R | `compactionBefore` returns `EventOf<'compaction'>` | B |
| kernel `prompt-snapshot.ts` | `payload as unknown as PromptSnapshotPayload` | V | `kind === 'system' && payload.type === 'prompt_snapshot'`, no cast | B |
| kernel `prompt-snapshot.ts`, `view.ts` snapshot refs | `typeof` / `isArray` on fields typed by that cast | R | `!== undefined` on typed fields | B |
| kernel `view.ts` `Capper.value` | lodash `isObjectLike` plus `as Record<string, unknown>` | V | es-toolkit `isPlainObject` | B |
| kernel `view.ts` `toView` | Capper output cast to payload and `Trace['session']` | V | Draft typed `unknown`; one `isTrace` on the final view | B |
| rpc `functions/list-sessions.ts` `checkQuery` | `typeof` object, `as Record`, `typeof` cascade | V | `zod/mini` schema, same messages | A, done |
| rpc `functions/report.ts` `checkInput` | `as Record`, `typeof` | V | `zod/mini` schema; an unknown locale still ignored | A, done |
| rpc `functions/trace-view.ts` handlers | `{ ref }`, `{ ref, id }`, `{ ref?, eventId }` unchecked | V | `zod/mini` parse in the handler | A, done |
| rpc `source-check.ts` `fingerprint` | `typeof` object, `as Record`, `typeof` cascade | V | `isPlainObject` and `isPrimitive`, then known-union `typeof` (E) | A, done |
| rpc `source-check.ts` `recordAt`, cli `session.ts` | `JSON.parse(…) as unknown` / `: unknown` | K | Widening to `unknown`, parsed afterwards | – |
| runtime-node `session-index-schema.ts`, `session-index.ts` `isBusy` | `(error as { errcode?: unknown })` plus `typeof` | V | `sqliteErrcode()` through `z.object({ errcode: z.number() })` | A, done |
| runtime-node `session-index-schema.ts` `rebuildUnderLock`, cli `report.ts` `reserveDir` | `(error as { code?: unknown }).code !== 'EEXIST'` | V | `z.object({ code: z.literal('EEXIST') })` | A, done |
| runtime-node `session-index-schema.ts` `readVersion`, `isEmpty`; `session-index.ts` row reads | row casts, `readNumber(unknown)`, `String()` / `Number()` | V | Row schemas per SELECT (D7) | A, done |
| runtime-node `session-index.ts` `summaryOf` | `typeof` plus `JSON.parse` plus `every(typeof)` on `context_shape` | V | `try JSON.parse` plus `z.array(z.number())` | A, done |
| runtime-node `session-index.ts` `casefold` function | `typeof value === 'string'` | E | `SQLOutputValue` is a known union | – |
| runtime-node `suppress-sqlite-warning.ts` | `typeof` cascade and casts on `unknown` arguments; `bind(...) as` | V | Arguments typed after `emitWarning`'s overloads, known-union narrowing | A, done |
| cli `report-site.ts` `bakedReport` | dump manifest and record: `JSON.parse(...) as {...}` | V | `zod/mini` schemas; `output` stays `unknown` | A, done |
| cli `terminal.ts` `wrap` | `typeof item === 'function'` plus a cast on an `unknown[]` rest; `rest as []` | V | Rest typed after `Writable.write`'s overloads; known-union narrowing | A, done |
| cli `scripts/third-party-notices.ts` `readManifest` | `JSON.parse` returned as a typed manifest | V | `z.object` manifest schema | A, done |
| cli `transcript-trace.ts` | `events.map(e => ({ ...e }))`: loose payloads into `Trace` | – | Kit 0.13.0 events assigned as they are (D4b, D10) | B |
| web `lib/event-text.ts` `toolTarget` | `asRecord(args)` plus a `typeof` cascade | V | Display schemas (3.5) | B |
| web `lib/event-text.ts` row text, `numberField` | `$truncated` isArray, helpers on name, model, finishReason, text, type | R | Per-kind `switch`; `numberField` deleted | B |
| web `lib/event-text.ts`, `tab-text.ts`, `event-row.tsx` | reads of `tool_result.text`, `compaction.summary`, `tool_result.durationMs` | R | Delete: no producer writes them | B |
| web `lib/ledger-model.ts`, `inspector.tsx`, `tab-text.ts`, `turn-header.tsx`, `compaction-row.tsx`, `tool-status.tsx` | `asString` callId / finishReason, `typeof` text / summaryEventId, `numberField` | R | Narrowed reads | B |
| web `lib/error-message.ts` | `typeof error === 'object' && 'message' in error` | V | `messageOf` through `z.object({ message: z.string() })` | B |
| web `inspector.tsx` error reads | `(x.error as Error \| undefined)?.message` | V | `messageOf(x.error)` | B |
| web `shell/report.ts` | `JSON.parse(text) as ReportTrace` | V | `isReportTrace` schema guard | B |
| web `workspace/load-session.ts` | `call` returning `any` cast to `LoadClient['call']` | V | Seam with three typed methods | B |
| web `lib/event-text.ts`, `lib/preview.ts`; kernel `view.ts` | `typeof value === 'string'` in generic JSON serializers | K | Built-in primitive test, not a shape guard | – |
| `session-ref.ts`, cli `trace-store.ts`, rpc `trace-store.ts`, `catalog.ts` | `typeof` / `in` on `string \| SessionRef`, `string \| Uint8Array`, result unions | E | Known-union narrowing | – |
| `instanceof Error`, `SyntaxError`, `LayoutMismatch`, `LoadCancelledError` | nominal class checks | K | Not a shape guard | – |
| web `shell/client.ts`, `i18n/locale.ts` | `as ScopedClient`, `params as Record<string, string>` | K | Library type adaptation of known types | – |
| `typeof document`, `typeof AGENT_TRACE_BUNDLE` | environment and build constant | K | Not data | – |
| schema `types.ts`, `index.ts` | loose `payload`, `usage: z.unknown()`, "a trace is not rejected for payload content" | – | 3.5; comment rewritten; `isTrace` stays a schema guard | B |
| rpc `handler-input.test.ts` `wire` | `setup as (context: unknown) => …` | T | A `z.function` schema gives the setup and its handler their wire types (any input, any result); no cast | A, done |
| tests in kernel, cli, web, rpc `testing/`; e2e `harness.ts`, `scale.e2e.ts`, `tarball.ts` | casts in test code | T | Fixed where PR B touches the file | B / – |
| root `scripts/*.mjs` | field reads on `JSON.parse` output | K | Dependency-free JS at the root; repository-owned inputs | – |

## 9. Appendix B: measurements

Payload sweep (draft schemas = 3.5), at `3f100ad`: 282 sessions loaded through `loadSession` (all fixtures, every local Claude Code and Grok session, the 6 largest Codex sessions and every 25th of the rest), 382,476 events, 0 payload schema failures. It found 9 undeclared keys on `system` and 3 on `hook`. The canonical generator's output failed only on `hook` without `type`.

Guard cost of a whole-event discriminated union, at `3f100ad` (now needed only for canonical files, report JSON, and the view):

| Session | Events | Load | Event guard | fitView (cap) | View guard (once) |
|---|---|---|---|---|---|
| Claude Code 81.6 MB | 11,041 | 288 ms | 24 ms | 49 ms (4096) | 28 ms |
| Claude Code 63.8 MB | 81,115 | 1,843 ms | 170 ms | 3,528 ms (256, 44.1 MB, over budget) | 189 ms |
| Codex 355 MB | 13,163 | 781 ms | 27 ms | 151 ms (2304) | 30 ms |
| Codex 341 MB | 5,173 | 537 ms | 10 ms | 24 ms (4096) | 11 ms |
| Codex 286 MB | 13,627 | 878 ms | 29 ms | 154 ms (2304) | 29 ms |

`fingerprint` over 81k originals, at `3f100ad`: hand-written 170 ms, es-toolkit 171 ms, zod per value 465 ms, zod record plus catch 598 ms; the same hashes in all forms. Re-measured for PR A on a 67.5 MB Claude Code session (33,945 records, repeated to 81,000 calls, median of 9 runs): hand-written 108.3 ms, es-toolkit 109.9 ms, the same hashes.

Session index with 5,000 rows, PR A against `main` (median of 11 runs): `rows()` 15.1 ms against 10.6 ms; `putHeads` of 5,000 unchanged heads 13.0 ms against 11.3 ms. About 1 µs per row, once per launch.

Web bundle at `3f100ad` (Vite): 286.8 KB raw / 94.6 KB gzip, no zod. The schema module imported for one constant: 22.9 KB / 6.3 KB gzip; trace parse 36.2 KB / 8.8 KB; trace plus report parse 39.3 KB / 9.5 KB.
