# Architecture

Audience: someone changing the viewer or the session reading. Session reading (discovery, detection, parsing, summaries) is `@rivus/agent-kit`'s; only `apps/cli` imports it at runtime. Other packages may use its types with `import type`, such as `SessionSummary` from `@rivus/agent-kit/transcript` and `SessionRef` (`{ agent, path, sessionId? }`) from `@rivus/agent-kit/sessions`. Trace names the coding agent `agent` everywhere, as the kit does: in `SessionRef`, the canonical `Trace.agent`, the wire rows, and the index.

## Shape

```text
agent roots
  -> kit adapter.discover (head/tail, 64 KB each end)      -> rows
  -> session index (index.sqlite, trace id + size + mtime) -> cached numbers
  -> kit summarize pass, 4 at a time, newest first         -> summary updates
  -> DevFrame list-sessions + shared state `sessions`      -> session browser

agent log
  -> kit session adapter (platform fs, onProgress, AbortSignal)
  -> Trace { schema: agent-trace, events[] with source pointers }
  -> rpc TraceStore (traceId -> session catalog): last 3 traces, originals dropped
  -> kernel toView / fold / reconstruct / projections
  -> DevFrame load-trace (progress stream) + get-trace-view + get-event
  -> Solid workspace: header, SVG timeline, virtualized ledger, inspector

one session (build <path>, or export-report on the dev server)
  -> buildReport: view trace + summary + first events in full, always redacted
  -> DevFrame static build baking report-trace
  -> packForFile: one index.html (report JSON, script, styles, fonts inlined)
  -> the same SPA in report mode, opened from file://
```

`events[]` is the archive. Every event can return its original: the store keeps each event's source pointer (file, byte offset, length) and `get-event(traceId, id)` reads that line again through the platform file system. The store records each source file's size and mtime at load and a fingerprint of each record; if the file changed since (a live session appends), the bytes must still parse to the same record, else the event comes back with `originalUnavailable` and the reason. A canonical JSON file keeps originals inside the file, so `get-event` reloads it once per cached entry.

`apps/cli/src/session-conformance.test.ts` runs the kit's `sessionAdapterConformance` for each builtin adapter on `fixtures/sessions/<agent>/conformance`. It holds the reading rules this viewer relies on: every input record becomes one or more events or one `skipped` entry with a reason, a second load gives the same event ids in the same order, every source pointer reads back its original, and a trace lists `systemPrompt` and `toolSchemas` exactly when its files record that content (every other capability means the agent records that kind of data, not that the session has any).

## Event payloads and parsing

`TraceEvent` (`packages/schema/src/types.ts`) is the kit's `TranscriptEvent`, a union discriminated by `kind`, with the fields a view trace adds on each payload: `$truncated`, and `systemPromptSameAs` / `toolsSameAs` on `system`. The kernel and the web app narrow on `event.kind` and read typed fields; a field an agent adds of its own stays in the payload, read as `unknown`, and the Input tab shows it. Unknown data is parsed once where it enters, and the code after that reads typed values:

| Input | Where | Check |
|---|---|---|
| Agent records | kit adapters | the kit's `zod/mini` schemas; `transcriptToTrace` puts the kit's events into the `Trace` as they are |
| Canonical JSON file | `apps/cli` `loadSession` | `isTrace`, every payload against its kind; a file that fails is read through the kit like any other file |
| View trace | kernel `toView` / `fitView` | `assertTrace` once on the view returned (not on every cap `fitView` measures); a view that is not a `Trace` throws |
| Report JSON | web `shell/report.ts` | the trace schema, the kit's `SessionSummary`, and the event detail; throws with the first issue |
| RPC inputs (browser, MCP) | each rpc handler | a `zod/mini` schema whose `error` texts are the messages clients see |
| Index rows, caught errors, `emitWarning` arguments | `runtime-node` | one row schema per SELECT; `z.object` for `errcode` and `EEXIST`; Node's overload types |
| DevFrame dump files, package manifests | `apps/cli` | `zod/mini` schemas |

The per-kind payload schemas are loose objects over the kit's declared fields. `satisfies` ties each one's output to the kit's payload type and `payloads.test.ts` checks that every payload of that type passes, so a declared field cannot drift from the kit's type and a required field the kit adds fails the type check. A new optional kit field passes both: the loose object keeps it, unchecked until the schema declares it. The schemas have no defaults or transforms, and callers keep the checked value through a guard rather than the parse output, so identity and key order stay as recorded and the canonical fixture loads equal to its file. Live RPC results are not parsed again in the browser: both ends ship in one tarball, and the server checked the value at one of the points above. Handlers parse their own input rather than through DevFrame's `args` option, which would advertise positional `arg0` on the MCP surface and break `reconstruct { eventId }`.

The index is a cache: a stored row whose head does not parse is deleted with its prompts and search row, and the next discover pass writes it again; a summary that does not parse is not served; a damaged `context_shape` loses only the shape. Walks over arbitrary JSON, where a schema per value costs too much (the source-record fingerprint, the view's string cap), use es-toolkit's `isPlainObject` and `isPrimitive`.

## Session index and session catalog

`apps/cli/src/catalog.ts` is the session catalog. For each registered session adapter it calls `roots(home)` and `discover`, stats each file for the cache key, and serves the rows through `list-sessions`. A root that does not exist yields an agent entry with `count: 0` and the checked path. A file that `discover` or `summarize` cannot read is a row with `error` (reason, file, line). Claude Code subagent files are folded into their parent by the kit adapter.

The CLI's default registry also includes the versioned NDJSON capture written by `agent-trace dsh-plugin install`. The generated Cordis plugin observes dsh's agent/session/tools callbacks, keeps concurrent sessions in separate files, and drains queued writes at `session/flush`. Its own `SessionAdapter` validates records with `zod/mini`, preserves physical byte pointers for originals, and rejects unknown generations. It records lifecycle observations and per-message usage, not model-visible prompts; absent prompt data stays unavailable. Both `DSH_HOME` and the optional `DSH_AGENT_TRACE_DIR` override apply to capture and discovery.

Summaries run 4 at a time, newest activity first; `list-sessions({ first })` moves the rows on screen to the front, and a file of 64 MB or more runs alone. Each summary is the kit's `summarizeSession`: the adapter's bounded pass when it has one (numbers and the main agent's user prompts for search, without holding the transcript), else the folded load. The prompts are the user's own: the kit's rule skips compact summaries, meta notes, slash-command wrappers, interruptions, and agent-injected text. Finished summaries are written in one transaction per batch and announced through the DevFrame shared state `agent-trace:sessions` (`{ revision, pending }`); the browser then asks `list-sessions({ since })` for the rows that changed. Search is `list-sessions({ query })` and runs in the index; with `--no-index`, an unavailable index, or a busy one, the same substring rule runs in memory over titles and first prompts.

`packages/runtime-node/src/session-index.ts` owns `index.sqlite` (`$XDG_CACHE_HOME/rivus-agent-trace/`, else `~/.cache/rivus-agent-trace/`, mode 0600) through `node:sqlite`: `sessions` (head fields, summary numbers, cache key), `prompts` (first 200 prompts, 500 characters each), and `search`, an FTS5 `trigram` table with one row per session. Queries of 3 or more characters use FTS5; shorter ones are a substring match over titles and prompts, with one JavaScript case fold (a registered `casefold()` function) on both sides, so `Über` and `Добро` match in any case. Each summary row stores the shell's `INDEX_SUMMARY_VERSION = SESSION_SUMMARY_VERSION + HOST_ERA_OFFSET + INDEX_CONTENT_REVISION`; a row from another version is recomputed. The components are defined in [`apps/cli/src/catalog.ts`](../../apps/cli/src/catalog.ts). The index runs in WAL mode with a 200 ms busy timeout (node:sqlite is synchronous, so a longer wait would block the server): readers never wait for another process, and a write that cannot get the lock is skipped. The schema is created inside `BEGIN IMMEDIATE`, so several processes can open a fresh cache at once; a broken or other-layout file is rebuilt only by the process holding `index.sqlite.lock`; an index that cannot be opened (for example a read-only cache directory) is skipped with one warning. `PRAGMA user_version` records the layout; a different version or an unreadable file is deleted and rebuilt. On a second launch the rows come from the index at once and the `discover` pass reconciles them in the background. `--no-index` opens nothing. Because the first screen needs only `discover` and index reads, rows are meant to appear within 2 s even with thousands of sessions and gigabytes of logs; no automated test measures that time.

A session is addressed by its trace id (`traceId`), a hash of agent and path. OpenCode list rows always include the session id, even when the database contains one session; open them with `agent-trace <path>#<sessionId>`. Other agents include it when several sessions share one file (the `path#id` form), so a single-session file opened with `agent-trace <path>` keeps its list-row trace id. On the command line a `path` or `path#id` string is parsed once into the kit's `SessionTarget` (`parseSessionTarget`); a discovered session is the kit's `SessionRef`. Titles, projects, and prompts in the list and the `--pick` labels are redacted like the workspace (home directory and token patterns) unless `AGENT_TRACE_REDACT=0`. The catalog keeps the trace id → target map and is the TraceStore's resolver: every list row resolves, and so does a session opened from the command line (by path or `--pick`), which also becomes `current`. URLs carry only the trace id (`#/s/<traceId>`). The CLI opens `?s=<traceId>`, because DevFrame's one-time code takes the URL fragment; the SPA moves the id to `#/s/<traceId>` once its first connection attempt ends, whether or not it succeeds.

## View trace, loading, and reconstruct

`get-trace-view(traceId)` returns `toView(trace)`: no `original`, every string and key capped at 4,096 UTF-16 units (never splitting a surrogate pair) with the shortened paths in `payload.$truncated` as key/index arrays, source files interned in `sourceFiles`, and `skipped` merged per file and reason. `fitView` lowers the cap, in steps of 0.75, only when the view would exceed the 12 MB budget; the view records the cap in `view.maxString`, and `view.withinBudget: false` (also logged once on the server) when even the 256 floor does not fit. The workspace shows a notice when the cap is below 4,096 or the view is over budget. The view keeps each distinct prompt-snapshot system prompt and non-empty tool list once, on the first snapshot that has it; a later snapshot with the same content names that one in `systemPromptSameAs` / `toolsSameAs` and lists the field in `payload.$truncated`, so `get-event` returns it in full and `reconstruct` gives the same result on the view. Codex event ids are `L<line>` (one file per trace) to keep per-event overhead low.

Loading: the browser calls `load-trace(traceId)`, subscribes to the `load-progress` stream with the returned id (bytes read of file size), then calls `get-trace-view(traceId)`. It takes two calls because DevFrame rejects a subscription to a stream id that does not exist yet (`DF0030`). Loads are shared per session. Cancelling the stream, disconnecting, not subscribing within 5 s, or a newer `load-trace` from the same connection releases the hold; the last release aborts the load. That connection's `get-trace-view` rides on its hold; any other reader (another tab, MCP `reconstruct`) takes its own, so one browser's navigation never cancels another reader. Holds do not reach the loaded trace, so an evicted trace is collectable. Error messages leave the store redacted. `traceId` is opaque and resolved by the shell: on the dev server through the session catalog (the TraceStore's cache key is the trace id, so `current` and the launch session's list row share one entry); under `mcp` and `build` only `current` resolves, keyed by the launch session's `path#id` string. The workspace route shows that progress (bytes read of file size), calls `get-trace-view(traceId)`, and calls `get-event(traceId, id)` for the Raw tab and for the full text of a shortened event. DevFrame 1.0.0 does not reconnect a closed WebSocket, so when the socket drops the workspace and the session browser say "Lost the connection to the agent-trace server" and offer Reload; a loaded workspace stays readable under that notice.

Projections, all pure over `Trace`: `projectRequests` (one entry per request, recorded numbers only), `projectLanes` (main lane plus one per subagent, with requests and prompt, failed-tool, and compaction markers), `projectTurns` (turns start at main-lane prompts; hook runs fold into one row; per-turn totals), and `hiddenAfterCompaction` (from `shadowedBy`). `fold` adds session summary numbers only for capabilities the agent declares.

`reconstruct(trace, eventId)` works on the event's lane (a subagent lane without a prompt record starts its turn at the lane start; its system prompt counts only if that lane records one). It returns the visible ids, the events a compaction removed, the slots (system prompt, tools, summary, messages, current turn) with `present` / `empty` / `unavailable`; when the trace has prompt snapshots (`system` events with `type: 'prompt_snapshot'`), the system prompt and tools come from the latest snapshot at or before the event on its lane (`slot.recordedBy`), and `tokens[]`, the counts the agent recorded with the slots each covers: the request's input tokens, and the compaction's `postTokens` for the first request after it. It never estimates a slot and does not invent messages.

The `reconstruct` RPC takes `{ traceId?, eventId }`; without a trace id (MCP) it reads `current`, the launch session.

## Packages

| Package | Role |
|---|---|
| `packages/schema` (`@rivus/agent-trace-schema`) | Canonical `Trace` (`schema: 'agent-trace'`), kinds, capabilities, `shadowedBy`, event payload types built on the kit's, and the `zod/mini` schemas that check JSON traces |
| `packages/kernel` (`@rivus/agent-trace-kernel`) | canonical-file head check, `SessionFs` read shape, fold, reconstruct, `toView` / `fitView`, projections |
| `packages/runtime-node` (`@rivus/agent-trace-runtime-node`) | home directory, session index (`node:sqlite`) |
| `packages/rpc` (`@rivus/agent-trace-rpc`) | `list-sessions` over an injected session service; `load-trace`, `get-trace-view`, `get-event`, `reconstruct` over `TraceStore` with an injected resolver; `export-report` over an injected writer; `buildReport`; `report-trace`, registered only in DevFrame's build mode |
| `apps/web` (`@rivus/agent-trace-web`) | Solid SPA: hash routes `#/` (session browser) and `#/s/<traceId>` (workspace), report mode, design tokens, `en` / `zh-CN` dictionaries |
| `apps/cli` (`@rivus/agent-trace`) | DevFrame CLI, the session catalog, the TraceStore wiring, and the report writer; the only published package |
| `apps/e2e` (`@rivus/agent-trace-e2e`) | Private: CLI smoke and Playwright suites against the installed tarball |

## Workspace

`#/s/<traceId>` draws, top to bottom: the session header (`summary` from `get-trace-view`, which is `fold` of the trace; "—" for undeclared capabilities), the SVG timeline, the ledger, and the inspector. Everything on the page is computed in the browser from the view trace with the kernel:

- Timeline (`apps/web/src/workspace/timeline/`): `projectLanes` gives the lanes, requests, and markers. Bar height is the request's recorded input tokens; a request without usage is a hollow bar. Requests closer than 3.5 px share one bar (the largest value), so a 10,000-event session stays a small SVG. Compaction is a dashed rule, boxed with `pre → post` when recorded; rules too close to box keep the label as a tooltip. Dragging selects a range; the two handles are `role="slider"` and move with the arrow keys (1 %, Shift 10 %), Home and End. Brush math is in `lib/timeline-scale.ts`.
- Ledger (`workspace/ledger/`): `lib/ledger-model.ts` builds turns from `projectTurns`, folds hook runs with `foldHookRuns`, pairs tool results with their calls, and puts each subagent lane's events of a turn behind one row at its spawn call. `flattenLedger` applies collapse, expansion, the kind chips, and the brush range. `@tanstack/solid-virtual` draws fixed sizes per row type (36 px rows, 40 px turn headers, 30 px hook fold, 44 px compaction), so the DOM holds about 40 rows at any scroll position. The dim toggle uses `hiddenAfterCompaction`.
- Inspector (`workspace/inspector/`): Input and Output show normalized fields; a shortened event (`payload.$truncated`) loads its full text through `get-event` on selection. Model saw is kernel `reconstruct` on the view trace: slots with their status, the recorded token counts with the slots each covers, and the removed events. Raw is `get-event`'s original record.

A failed load shows the reason, the agent, file, and line when the error names them, a retry, and a link back to the session browser. The timeline and the session browser's context shape are SVG drawn from kernel projections; there is no chart library.

The theme follows `prefers-color-scheme` until the user picks dark or light, which `localStorage` keeps (`apps/web/src/shell/theme.ts`). The UI is English or Simplified Chinese (`apps/web/src/i18n/locale.ts`): `zh-CN` when the browser's first preferred language starts with `zh`, else `en`; a manual switch is kept in `localStorage`, and `<html lang>` follows the active locale. Dates, times, durations, and numbers go through `apps/web/src/lib/format.ts` (`Intl` for the locale); token counts keep the `k` and `M` abbreviations in both languages. Session content is shown as recorded and never translated.

## Report

A report is one session's workspace as a static page that opens from `file://` with no server. `build <path> --out-dir <dir>` and the workspace's "Export report" (`export-report(traceId, locale)`) run the same pipeline in `apps/cli/src/report.ts`:

1. `buildReport` (`packages/rpc/src/report.ts`) takes the view trace and summary as `get-trace-view` returns them, and the full events (payload and original record) of the first events in order, until 2,000 events or 20 MB of serialized events, whichever comes first. Everything passes through `redact` with the home directory, whatever `AGENT_TRACE_REDACT` says. `build` takes the full events from the trace it already loaded (the file is read once); the export reads them through `TraceStore.withEvents`, which reads source pointers a few at a time, or reloads a canonical file once for the whole report.
2. DevFrame's `createBuild` runs the definition's `setup` in build mode, which registers one extra argument-free snapshot query, `report-trace`, bound to that payload, and bakes it into `__rpc-dump/`. Build mode skips the session push, so an export inside the dev server leaves the live server's shared state alone. Exports run one at a time; each creates its own `agent-trace-report-<traceId>-<time>` directory in the server's working directory before writing, and its error message is redacted before it reaches the browser.
3. `packForFile` (`apps/cli/src/report-site.ts`) makes the build open from disk. Chromium refuses `fetch()`, module scripts, and fonts from `file://`, so the baked `report-trace` output moves into `index.html` as `<script type="application/json" id="report-trace">`, the module script (the web build is one chunk; any other script fails the build) and the stylesheet are inlined (`woff2` fonts as data URIs), and `assets/`, `__rpc-dump/`, and `__connection.json` are removed. The result is a single `index.html`.

The SPA starts in report mode when it finds that element (`apps/web/src/shell/report.ts`): no DevFrame connection, no session browser, no Export button. The workspace reads the view trace from the report; `get-event` becomes a lookup in the included events, and any other event shows its view with "not included in this report" in Raw. Model saw runs `reconstruct` in the browser as on the dev server. A banner says that session text and file contents remain, and how many originals are included when the report holds fewer than all events. The report opens in the UI locale recorded at export time (`build` records none, so the browser's language decides) and keeps the language and theme switches.

## Exports

`export-atif <path> [--out <file>]` and `export-otlp <path> [--out <file>]` (`apps/cli/src/export.ts`) load a session once and write one file: an ATIF v1.8 trajectory (`toAtif`, `packages/kernel/src/export-atif.ts`) or an OTLP/JSON `ExportTraceServiceRequest` (`toOtlp`, `packages/kernel/src/export-otlp.ts`). Both projections are pure functions over a checked `Trace` with no `node:*` import; the CLI redacts and writes. ATIF maps per the delivery plan's table ([plan 0002](../plans/0002-export-atif-otlp.md)): one step per user event, per `requestId` group, and per compaction (a system step with `extra.context_management`), subagent lanes as embedded `subagent_trajectories` referenced from the spawn step, fields ATIF has no place for under `extra.agent_trace` with the canonical event ids. OTLP pins the semconv version named by `OTLP_SEMCONV_VERSION` (`gen-ai-dev/1.42.0-dev` at implementation time): one `invoke_agent` span per lane, one `chat` span per request with the `gen_ai.usage.*` counts and the model-visible surface from `reconstruct` as `gen_ai.input.messages` / `gen_ai.output.messages` / `gen_ai.system_instructions` / `gen_ai.tool.definitions`, and one `execute_tool` span per tool call. A trace with nothing the formats can hold (no user, agent, or system-prompt content) fails the export with that reason; a subagent lane with no exportable events is left out, its spawn ref with it. Exports are redacted like the server unless `AGENT_TRACE_REDACT=0`; `node scripts/validate-exports.mjs` exports every agent's fixtures and runs Harbor's validator.

## Bundle

`apps/cli` builds with `vp pack` into `dist/bin.mjs` (Node version check, then a dynamic import) and `dist/cli.mjs` (the CLI with every `@rivus/*` package bundled; `devframe`, `@devframes/agentic`, and `cac` stay runtime dependencies). The web build is copied into `dist/web/`, and `src/paths.ts` finds it there through the build-time constant `AGENT_TRACE_BUNDLE`. The web bundle includes `zod/mini` and the trace schemas for the report check (about 8 KB gzip); no size budget is set. `apps/e2e` tests the packed tarball from outside: `test:smoke` (CLI, S2, S10, S13, S15, S16) and `test:e2e` (Playwright, the browser scenarios).

## Terminal

Commands are parsed by DevFrame's cac. In a terminal the CLI draws with `@clack/prompts` (`apps/cli/src/terminal.ts`, `terminal-index.ts`): a start line with name and version, index progress per agent, a load spinner, the `build` steps, the URL in a box when it fits the terminal width (an OSC 8 link where the terminal supports it) and otherwise one `Ready: <url>` line, and errors as the cause plus one line on how to fix it. When stdout is not a terminal or `NO_COLOR` is set, the same moments are plain lines, and escape sequences are stripped from every line, DevFrame's own `[devframe]` lines included (they print color codes even with `NO_COLOR`). `mcp` writes only protocol messages to stdout and everything else to stderr. `--pick` without an interactive stdin exits 1. CLI and MCP output are English only.

## Trust

Session files stay on disk. The dev server binds localhost. The index holds titles, user prompts (500 characters each), paths, and numbers, in the user's cache directory with mode 0600. `build`, "Export report", and `mcp` always redact (home directory and token patterns); a report still holds session text and file contents, and says so. The ATIF and OTLP exports are redacted like the server, with `AGENT_TRACE_REDACT=0` writing the unredacted bytes. Redaction is the kit's (`@rivus/agent-kit/redact`, imported by `apps/cli`): it replaces the home directory wherever it appears in a string (also inside `a/<home>/…` in a git diff header), without its leading `/` (`Users/<name>/…`), JSON-escaped (`\/Users\/<name>`), and in Claude's dash slug and Grok's `%2F` form, ignoring case, in values and keys; a longer name (`/Users/<name>x`, `/Users/<name>.bak`) stays. The dev server redacts the view trace, `get-event`, error messages, and list rows alike, unless `AGENT_TRACE_REDACT=0`. Do not put machine paths or live secrets into fixtures.

## Compatibility

The CLI commands and flags are the public interface. The canonical trace file format and the workspace packages' exports are not stable: they change in place, with no compatibility layer or reader for an older shape.

## Out of the current viewer

Not built: the ⌘K jump palette (the box focuses the ledger) and a composer overlay.

Not supported:

- agents outside the supported-agent list in the [README](../../README.md#supported-agents);
- live follow of a running session, and editing or replaying a session;
- search over session content beyond titles and the user's prompts;
- UI languages other than English and Simplified Chinese;
- accounts, upload, or a hosted service.

`@rivus/agent-trace` is not published to the npm registry yet.
