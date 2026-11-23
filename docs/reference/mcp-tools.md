# MCP tools reference

Audience: someone who writes an MCP client against `estela mcp`, or changes the tools. This page lists each tool's input schema and result fields as the code in `packages/server/src/agent-tools/` defines them (`inputs.ts`, `session-list.ts`, `trace-reads.ts`, `event-read.ts`, `bounds.ts`, `register.ts`). How to set the server up is in the [MCP guide](../guide/mcp.md); what semver covers is in [Public interface](public-interface.md#mcp-tools).

## Conventions

- Every tool is read-only. Each input is a JSON object; an unknown property is an error.
- Each result is one compact JSON text of at most 40,000 characters.
- Times are ISO 8601 UTC strings. Paths show `~` for the home directory.
- A field that is absent was not recorded. In a session item with `summary: "pending"`, an absent count means it is not computed yet. A count is never 0 by default.
- `traceId` in a session tool is optional; left out, it names `current`, the session the server was started with (only `estela mcp <session>` and a dev server started with a session have one).
- Event and lane ids are returned as written only when they are 1 to 128 characters of letters, digits, `_`, `.`, `:`, `-` and redaction leaves them unchanged; any other id is returned as `@e<n>` (event, by position) or `@l<n>` (lane, by position), and every tool accepts that form back. A repeated id names the last event with it.
- `truncated` lists cut fields as paths (arrays of keys and indexes) from the object that carries it.

## Inputs

| Tool | Property | Type and range | Default |
|---|---|---|---|
| `estela_list_sessions` | `agent` | string, ≤ 64 characters, an agent id | all agents |
| | `project` | string, ≤ 500; part of the project name, ignoring case | |
| | `cwd` | string, ≤ 1000; an absolute path or one starting with `~`; that directory and those inside it | |
| | `since` | date `YYYY-MM-DD` (00:00 UTC) or date-time with `Z` or an offset; sessions active at or after it | |
| | `until` | same format; sessions that started at or before it (last activity when no start is recorded) | |
| | `hasCompaction`, `hasFailedTools` | boolean; `true`: at least one; `false`: the count is recorded and is 0 | |
| | `offset` | integer 0–100000 | 0 |
| | `limit` | integer 1–50 | 20 |
| `estela_search_sessions` | `query` (required) | string, 1–200; matched in titles and the user's own prompts, ignoring case | |
| | every `estela_list_sessions` property | | |
| `estela_session_summary` | `traceId` | string, 1–200 | `current` |
| `estela_list_turns` | `traceId`, `offset`, `limit` | `limit` integer 1–100 | `limit` 20 |
| `estela_list_requests` | `traceId`, `lane` (string ≤ 200, a lane id), `turn` (integer 0–100000, a turn `index`), `offset`, `limit` | `limit` integer 1–200 | `limit` 50 |
| `estela_get_event` | `traceId`, `eventId` (required, string 1–200), `maxChars` (integer 256–20000), `original` (boolean) | | `maxChars` 2000, `original` false |
| `estela_reconstruct` | `traceId`, `eventId` (required, string 1–200) | | |

`hasCompaction` and `hasFailedTools` never match a session whose agent does not record the count. When matching sessions are not counted yet, the tool asks for their counts first and waits up to 5 seconds; sessions still not counted are left out and counted in `unsummarized`.

## Results

### `estela_list_sessions`, `estela_search_sessions`

`{ sessions, total, offset, nextOffset?, unsummarized?, agents }`

| Field | Meaning |
|---|---|
| `sessions` | the session items of this page, newest activity first |
| `total` | sessions that match, over every page |
| `nextOffset` | present when more sessions match; pass it as `offset` |
| `unsummarized` | sessions left out because their counts were still being computed (flag filters only) |
| `agents` | `[{ id, sessions }]`: every agent the server reads, with its session count |

A session item: `traceId`, `agent`, `title?`, `project?`, `cwd?`, `startedAt?`, `lastActiveAt`, `sizeBytes`, `firstPrompt?`, `summary`, the counts `turns?`, `requests?`, `inputTokens?`, `outputTokens?`, `durationMs?`, `compactions?`, `subagents?`, `failedTools?`, `error?` (`{ reason, file?, line? }`), and `truncated?`. `summary` is `ready`, `pending` (counts not computed yet), or `failed` (the session could not be read; see `error`). `sizeBytes` is the size of the session's file, and 0 for an OpenCode, ZCode, or DimCode session, whose database file holds other sessions too.

### `estela_session_summary`

`{ traceId, agent, agentVersion?, title?, cwd?, startedAt?, endedAt?, events, skippedRecords, capabilities, numbers, unavailable, lanes, laneCount, truncated? }`

| Field | Meaning |
|---|---|
| `events` | events read from the log |
| `skippedRecords` | log records that became no event |
| `capabilities` | what this agent's log can record ([Concepts](../guide/concepts.md#capabilities)) |
| `numbers` | the recorded counts among `turns`, `requests`, `inputTokens`, `outputTokens`, `durationMs`, `compactions`, `subagents`, `failedTools` |
| `unavailable` | the counts of that list this session's log does not record |
| `lanes` | at most 50 lanes: `{ id, parentId?, title?, depth, spawnEventId?, requests, failedTools, compactions }`; `depth` is 0 for the main lane, 1 for a subagent it started, and one more for each level of nesting; `spawnEventId` is the event that started the subagent |
| `laneCount` | lanes in the session |

### `estela_list_turns`

`{ traceId, total, offset, nextOffset?, turns }`. A turn: `index`, `promptEventId?` (absent for events before the first prompt), `prompt?`, `start`, `end`, `firstEventId`, `lastEventId`, `events`, `requests`, `inputTokens?`, `outputTokens?`, `durationMs?`, `failedTools`, `failedToolEventIds` (at most 20), `compactionEventIds` (at most 20), `truncated?`.

### `estela_list_requests`

`{ traceId, total, offset, nextOffset?, requests }`. A request: `id` (the `request` event; pass it to `estela_reconstruct`), `ts`, `lane`, `turn?`, `model?`, `inputTokens?`, `outputTokens?`, `durationMs?`, `finishReason?`, `granularity?` (`turn` or `session` when the usage covers more than one model call), `eventIds` (the replies and tool calls it produced, at most 20), `eventCount`, `truncated?`.

### `estela_get_event`

`{ traceId, maxChars, event }`. `maxChars` is the cap actually used. The event: `id`, `seq`, `ts`, `kind`, `lane`, `parentId?`, `requestId?`, `shadowedBy?` (the compaction that removed it from the model's context), `source` (`{ file, line }`), `payload`, `original?` (the parsed log record, with `original: true`), `originalUnavailable?` (why the record could not be read back), `truncated?`, `omitted?` (`original` and/or `payload`, left out to fit the bound; an omitted `payload` is returned as `{}`).

### `estela_reconstruct`

`{ traceId, eventId, completeness, unavailable, slots, tokens, visibleIds, visibleCount, removedIds, removedCount, truncated? }`

| Field | Meaning |
|---|---|
| `completeness` | `full`, or `partial` when a slot is unavailable |
| `unavailable` | the slot names the log does not record |
| `slots` | `{ name, status, eventIds, eventCount, recordedBy? }` for `system`, `tools`, `summary`, `messages`, `currentTurn`; `status` is `present`, `empty`, or `unavailable`; `recordedBy` is the prompt snapshot that recorded the system prompt or tools |
| `tokens` | the recorded counts with the slots each covers: `{ slots, tokens, from }`, where `from` is `request.inputTokens` or `compaction.postTokens` |
| `visibleIds`, `visibleCount` | the last ids the model saw (nearest the event) and their total |
| `removedIds`, `removedCount` | the last ids a compaction before the event removed, and their total |

## Bounds

| Bound | Value |
|---|---|
| Result size | 40,000 characters of JSON |
| List pages | `limit` items at most; a page ends early when the next item would pass the size bound, and `nextOffset` is set |
| Titles and project names in lists and the summary | 200 characters |
| Prompts, error reasons, paths | 300 characters |
| Other recorded strings in lists and the summary | 128 characters |
| Id lists inside an item | 20 ids |
| Lanes in the summary | 50 |
| `estela_get_event` strings | `maxChars`; if the result is still too large, `maxChars` is lowered in steps of 0.75 down to 256, then `original` and then `payload` are left out |
| `estela_reconstruct` id lists | the last 100 ids of each list, halved further while the result is over the bound |

Every recorded string is redacted before a tool cuts it, whatever `ESTELA_REDACT` says, so a tool's own cut never leaves part of a home path behind. A session title and a first prompt reach the tools already cut (a title at 80 characters, a first prompt at 500) before redaction; redaction also replaces a home path such a cut left partial at their end with `~`, in every spelling it knows ([Privacy](../guide/privacy.md)).

## Errors

A failed call is an MCP error result (`isError: true`). DevFrame, the server framework, puts its own prefix in front of Estela's message, so the text a client receives reads:

```text
Error invoking "estela_list_sessions": Error: estela_list_sessions: limit: expected an integer from 1 to 50
```

Estela's part of the message:

| Cause | Message |
|---|---|
| invalid input | `estela_<tool>: <field>: <what it expects>`, or `estela_<tool>: unknown argument "<key>"` |
| unknown agent | `unknown agent "<id>"; this server reads <ids>` |
| unknown trace id | `unknown trace id: <id>; estela_list_sessions lists the trace ids, and "current" exists only when the server was started with a session` |
| unknown event | `no event <id> in <traceId>` |
| unknown lane | `no lane <id> in <traceId>; estela_session_summary lists the lanes` |
| a session that does not load | the load error |

Every message is redacted.
