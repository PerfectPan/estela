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
  -> HostAdapter (TraceIO)
  -> Trace { schema: agent-trace, events[] }
  -> kernel fold / reconstruct / redact
  -> DevFrame getTrace / session-trace(ref)
  -> Solid ledger + inspector
```

`events[]` is the archive. Turn sections and paired tool rows are projections in the client. `original` stays on every event for the Raw tab. `fold` adds session summary numbers only for capabilities the host declares.

## Session index and session service

`apps/cli/src/catalog.ts` is the session service. For each registered host it calls `roots(env)` and `discover`, stats each file for the cache key, and serves the rows through `list-sessions`. A root that does not exist yields a host entry with `count: 0` and the checked path. A file that `discover` or `summarize` cannot read is a row with `error` (reason, file, line). Claude Code subagent files are folded into their parent by the adapter.

Summaries run 4 at a time, newest activity first; `list-sessions({ first })` moves the rows on screen to the front, and a file of 64 MB or more runs alone. Each summary is `fold(load())` (or `adapter.summarize`) plus the main agent's user prompts. Finished summaries are written in one transaction per batch and announced through the DevFrame shared state `agent-trace:sessions` (`{ revision, pending }`); the browser then asks `list-sessions({ since })` for the rows that changed. Search is `list-sessions({ query })` and runs in the index.

`packages/runtime-node/src/session-index.ts` owns `index.sqlite` (`$XDG_CACHE_HOME/rivus-agent-trace/`, else `~/.cache/rivus-agent-trace/`, mode 0600) through `node:sqlite`: `sessions` (head fields, summary numbers, cache key), `prompts` (first 200 prompts, 500 characters each), and `search`, an FTS5 `trigram` table with one row per session. Queries of 3 or more characters use FTS5; shorter ones match a title prefix. `PRAGMA user_version` records the layout; a different version or an unreadable file is deleted and rebuilt. On a second launch the rows come from the index at once and the `discover` pass reconciles them in the background. `--no-index` opens nothing.

A session is addressed by `ref`, a hash of host and path. The server keeps the ref → file map; URLs carry only the ref (`#/s/<ref>`). The server keeps the last 3 loaded traces.

`reconstruct(trace, eventId)` returns the ids still visible after compaction events in that prefix, plus slots that could not be recovered (`system`, `tools`). It does not invent messages.

## Packages

| Package | Role |
|---|---|
| `packages/schema` (`@rivus/agent-trace-schema`) | Canonical `Trace` (`schema: 'agent-trace'`), kinds, capabilities, `shadowedBy` |
| `packages/kernel` (`@rivus/agent-trace-kernel`) | `HostAdapter`, `TraceIO`, load, fold, reconstruct, redact, conformance |
| `packages/runtime-node` (`@rivus/agent-trace-runtime-node`) | `NodeIO`, `homeDir`, session index (`node:sqlite`) |
| `packages/rpc` (`@rivus/agent-trace-rpc`) | `list-sessions`, `get-trace`, `session-trace` (until M4's `get-trace-view`), and `reconstruct` over an injected session service |
| `packages/host-claude-code` | Claude Code JSONL, registered |
| `packages/host-codex` | Codex `rollout-*.jsonl`, registered |
| `packages/host-grok` | Grok `updates.jsonl` plus side files, registered |
| `packages/host-opencode` | OpenCode SQLite, kept, not registered |
| `packages/host-dsh` | detect stub, kept, not registered |
| `apps/web` (`@rivus/agent-trace-web`) | Solid SPA: hash routes `#/` (session browser) and `#/s/<ref>` (workspace), design tokens, `en` / `zh-CN` dictionaries |
| `apps/cli` (`@rivus/agent-trace`) | DevFrame CLI and the session service, the only published package |

## Trust

Session files stay on disk. The dev server binds localhost. The index holds titles, user prompts (500 characters each), paths, and numbers, in the user's cache directory with mode 0600. Static export should run through `redact` before sharing. Do not put machine paths or live secrets into fixtures.

## Out of the current viewer

The workspace timeline, ledger virtualization, request dots, turn collapse, and a composer overlay are not implemented (M4). dsh ingestion is not implemented.
