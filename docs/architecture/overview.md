# Architecture

Audience: someone changing the viewer or adding a host adapter.

## Shape

```text
host roots
  -> HostAdapter.discover (head/tail, 64 KB each end)      -> rows
  -> session index (index.sqlite, path + size + mtime)     -> cached numbers
  -> HostAdapter.load + fold, 4 at a time, newest first    -> summary updates
  -> DevFrame list-sessions + shared state `sessions`      -> session browser

host log
  -> HostAdapter (TraceIO, onProgress, AbortSignal)
  -> Trace { schema: agent-trace, events[] with source pointers }
  -> rpc TraceStore (ref -> session catalog): last 3 traces, originals dropped
  -> kernel toView / fold / reconstruct / projections / redact
  -> DevFrame load-trace (progress stream) + get-trace-view + get-event
  -> Solid workspace: header, SVG timeline, virtualized ledger, inspector
```

`events[]` is the archive. Every event can return its original: the store keeps each event's source pointer (file, byte offset, length) and `get-event(ref, id)` reads that line again (`readOriginal`). The store records each source file's size and mtime at load and a fingerprint of each record; if the file changed since (a live session appends), the bytes must still parse to the same record, else the event comes back with `originalUnavailable` and the reason. A canonical JSON file keeps originals inside the file, so `get-event` reloads it once per cached entry.

## Session index and session catalog

`apps/cli/src/catalog.ts` is the session catalog. For each registered host it calls `roots(env)` and `discover`, stats each file for the cache key, and serves the rows through `list-sessions`. A root that does not exist yields a host entry with `count: 0` and the checked path. A file that `discover` or `summarize` cannot read is a row with `error` (reason, file, line). Claude Code subagent files are folded into their parent by the adapter.

Summaries run 4 at a time, newest activity first; `list-sessions({ first })` moves the rows on screen to the front, and a file of 64 MB or more runs alone. Each summary is one `load()`: `fold` of that trace for the numbers, plus the main agent's user prompts for search. `adapter.summarize` is not called, because the prompts need the loaded trace anyway. Finished summaries are written in one transaction per batch and announced through the DevFrame shared state `agent-trace:sessions` (`{ revision, pending }`); the browser then asks `list-sessions({ since })` for the rows that changed. Search is `list-sessions({ query })` and runs in the index; with `--no-index`, an unavailable index, or a busy one, the same substring rule runs in memory over titles and first prompts.

`packages/runtime-node/src/session-index.ts` owns `index.sqlite` (`$XDG_CACHE_HOME/rivus-agent-trace/`, else `~/.cache/rivus-agent-trace/`, mode 0600) through `node:sqlite`: `sessions` (head fields, summary numbers, cache key), `prompts` (first 200 prompts, 500 characters each), and `search`, an FTS5 `trigram` table with one row per session. Queries of 3 or more characters use FTS5; shorter ones are a substring match over titles and prompts, with one JavaScript case fold (a registered `casefold()` function) on both sides, so `Über` and `Добро` match in any case. Each summary row stores the kernel's `SUMMARY_VERSION`; a row from another version is recomputed. The index runs in WAL mode with a 200 ms busy timeout (node:sqlite is synchronous, so a longer wait would block the server): readers never wait for another process, and a write that cannot get the lock is skipped. The schema is created inside `BEGIN IMMEDIATE`, so several processes can open a fresh cache at once; a broken or other-layout file is rebuilt only by the process holding `index.sqlite.lock`; an index that cannot be opened (for example a read-only cache directory) is skipped with one warning. `PRAGMA user_version` records the layout; a different version or an unreadable file is deleted and rebuilt. On a second launch the rows come from the index at once and the `discover` pass reconciles them in the background. `--no-index` opens nothing.

A session is addressed by `ref`, a hash of host and path. The session id counts only when several sessions share one file (the `path#id` form), so `agent-trace <path>` opens the same ref as that file's list row. Titles, projects, and prompts in the list and the `--pick` labels are redacted like the workspace (home directory and token patterns) unless `AGENT_TRACE_REDACT=0`. The catalog keeps the ref → file map and is the TraceStore's resolver: every list row resolves, and so does a session opened from the command line (by path or `--pick`), which also becomes `current`. URLs carry only the ref (`#/s/<ref>`).

## View trace, loading, and reconstruct

`get-trace-view(ref)` returns `toView(trace)`: no `original`, every string and key capped at 4,096 UTF-16 units (never splitting a surrogate pair) with the shortened paths in `payload.$truncated` as key/index arrays, source files interned in `sourceFiles`, and `skipped` merged per file and reason. `fitView` lowers the cap, in steps of 0.75, only when the view would exceed 12 MB (plan 1.3); the view records the cap in `view.maxString`, and `view.withinBudget: false` (also logged once on the server) when even the 256 floor does not fit. Codex event ids are `L<line>` (one file per trace) to keep per-event overhead low.

Loading: the browser calls `load-trace(ref)`, subscribes to the `load-progress` stream with the returned id (bytes read of file size), then calls `get-trace-view(ref)`. Loads are shared per session. Cancelling the stream, disconnecting, not subscribing within 5 s, or a newer `load-trace` from the same connection releases the hold; the last release aborts the load. That connection's `get-trace-view` rides on its hold; any other reader (another tab, MCP `reconstruct`) takes its own, so one browser's navigation never cancels another reader. Holds do not reach the loaded trace, so an evicted trace is collectable. Error messages leave the store redacted. `ref` is opaque and resolved by the shell: on the dev server through the session catalog (the TraceStore's cache key is the catalog ref, so `current` and the launch session's list row share one entry); under `mcp` and `build` only `current` resolves, keyed by the launch path. The workspace route shows that progress (bytes read of file size), calls `get-trace-view(ref)`, and calls `get-event(ref, id)` for the Raw tab and for the full text of a shortened event. After a WebSocket reconnect during a load it calls `load-trace` again.

Projections, all pure over `Trace`: `projectRequests` (one entry per request, recorded numbers only), `projectLanes` (main lane plus one per subagent, with requests and prompt, failed-tool, and compaction markers), `projectTurns` (turns start at main-lane prompts; hook runs fold into one row; per-turn totals), and `hiddenAfterCompaction` (from `shadowedBy`). `fold` adds session summary numbers only for capabilities the host declares.

`reconstruct(trace, eventId)` works on the event's lane (a subagent lane without a prompt record starts its turn at the lane start; its system prompt counts only if that lane records one). It returns the visible ids, the events a compaction removed, the slots (system prompt, tools, summary, messages, current turn) with `present` / `empty` / `unavailable`, and `tokens[]`, the counts the host recorded with the slots each covers: the request's input tokens, and the compaction's `postTokens` for the first request after it. It never estimates a slot and does not invent messages.

The `reconstruct` RPC takes `{ ref?, eventId }`; without a ref (MCP) it reads `current`, the launch session.

## Packages

| Package | Role |
|---|---|
| `packages/schema` (`@rivus/agent-trace-schema`) | Canonical `Trace` (`schema: 'agent-trace'`), kinds, capabilities, `shadowedBy` |
| `packages/kernel` (`@rivus/agent-trace-kernel`) | `HostAdapter`, `TraceIO`, load, fold, reconstruct, redact, `toView` / `fitView`, projections, conformance |
| `packages/runtime-node` (`@rivus/agent-trace-runtime-node`) | `NodeIO`, `homeDir`, session index (`node:sqlite`) |
| `packages/rpc` (`@rivus/agent-trace-rpc`) | `list-sessions` over an injected session service; `load-trace`, `get-trace-view`, `get-event`, `reconstruct` over `TraceStore` with an injected resolver; legacy `get-trace` for the static build and MCP (the dev server does not bind it) |
| `packages/host-claude-code` | Claude Code JSONL, registered |
| `packages/host-codex` | Codex `rollout-*.jsonl`, registered |
| `packages/host-grok` | Grok `updates.jsonl` plus side files, registered |
| `packages/host-opencode` | OpenCode SQLite, kept, not registered |
| `packages/host-dsh` | detect stub, kept, not registered |
| `apps/web` (`@rivus/agent-trace-web`) | Solid SPA: hash routes `#/` (session browser) and `#/s/<ref>` (workspace), design tokens, `en` / `zh-CN` dictionaries |

## Workspace

`#/s/<ref>` draws, top to bottom: the session header (`summary` from `get-trace-view`, which is `fold` of the trace; "—" for undeclared capabilities), the SVG timeline, the ledger, and the inspector. Everything on the page is computed in the browser from the view trace with the kernel:

- Timeline (`apps/web/src/workspace/timeline/`): `projectLanes` gives the lanes, requests, and markers. Bar height is the request's recorded input tokens; a request without usage is a hollow bar. Requests closer than 3.5 px share one bar (the largest value), so a 10,000-event session stays a small SVG. Compaction is a dashed rule, boxed with `pre → post` when recorded; rules too close to box keep the label as a tooltip. Dragging selects a range; the two handles are `role="slider"` and move with the arrow keys (1 %, Shift 10 %), Home and End. Brush math is in `lib/timeline-scale.ts`.
- Ledger (`workspace/ledger/`): `lib/ledger-model.ts` builds turns from `projectTurns`, folds hook runs with `foldHookRuns`, pairs tool results with their calls, and puts each subagent lane's events of a turn behind one row at its spawn call. `flattenLedger` applies collapse, expansion, the kind chips, and the brush range. `@tanstack/solid-virtual` draws fixed sizes per row type (36 px rows, 40 px turn headers, 30 px hook fold, 44 px compaction), so the DOM holds about 40 rows at any scroll position. The dim toggle uses `hiddenAfterCompaction`.
- Inspector (`workspace/inspector/`): Input and Output show normalized fields; a shortened event (`payload.$truncated`) loads its full text through `get-event` on selection. Model saw is kernel `reconstruct` on the view trace: slots with their status, the recorded token counts with the slots each covers, and the removed events. Raw is `get-event`'s original record.

A static build (until M5's `report-trace`) reads the argument-free `get-trace` snapshot and computes the summary with `fold` in the browser.
| `apps/cli` (`@rivus/agent-trace`) | DevFrame CLI, the session catalog, and the TraceStore wiring; the only published package |

## Trust

Session files stay on disk. The dev server binds localhost. The index holds titles, user prompts (500 characters each), paths, and numbers, in the user's cache directory with mode 0600. `build` and `mcp` always redact (home directory and token patterns). The dev server redacts the view trace, `get-event`, error messages, and list rows alike, unless `AGENT_TRACE_REDACT=0`. Do not put machine paths or live secrets into fixtures.

## Out of the current viewer

Not built: report export (M5; the header's "Export report" is a disabled placeholder), the ⌘K jump palette (the box focuses the ledger), and a composer overlay. dsh ingestion is not implemented.
