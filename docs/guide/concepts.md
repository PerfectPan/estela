# Concepts

Estela shows what an agent's log records and nothing else. These are the words the session browser, the workspace, the report, and the MCP tools use.

## Session

One conversation with an agent, as the agent saved it: a JSONL file, a folder of files, or rows in a database (OpenCode, DimCode, ZCode). Estela reads it and never writes to it. A session has a title (the agent's own, or the first prompt), a working directory, and the agent's version when the log records them.

## Event

One thing the log records, in order. Every event can show the log record it came from (the Raw tab). The kinds:

| Kind | Shown as | What it is |
|---|---|---|
| `user` | USER | A prompt you typed, or text the agent or a tool injected as a user message |
| `assistant` | REPLY | Text the model wrote |
| `reasoning` | REASONING | The model's recorded reasoning text |
| `tool_call`, `tool_result` | TOOL | A tool the model called, and what came back; a failed result is marked |
| `request` | REQUEST | One model request with its recorded usage (below) |
| `system` | SYSTEM | Agent bookkeeping: prompt snapshots, turn durations, instructions |
| `hook` | HOOK | A hook the agent ran |
| `compaction` | COMPACTED | A compaction (below) |
| `unknown` | UNKNOWN | A record the reader keeps but does not interpret |

A log line that is not valid JSON is skipped and counted; it does not stop the session from loading.

## Request

One call to the model, with what the log recorded about it: the model, input tokens (cache reads and writes included), output tokens, cache-read and cache-write tokens, the finish reason, and the duration. A field the log does not record is missing, not zero. Most agents record one request per model call; Grok records usage once per turn, so each Grok request covers a whole turn (see [Supported agents](supported-agents.md#known-limits)).

## Turn

Everything from one prompt you typed on the main agent to the next one. Hook runs inside a turn fold into one row in the ledger. A subagent's work belongs to the turn that started it.

## Lane

The main agent is one lane, and each subagent it starts is its own lane. Each lane is its own conversation with the model: what one lane's model saw does not include another lane's events. The timeline draws one row per lane, and the ledger's Agents layout groups events by lane.

## Compaction

Some agents replace older context with a summary when the context gets long. Estela shows the compaction as its own event, with the tokens before and after it when the agent records them (`45.5k → 15k`), and marks the events it removed from the model's view. Those events stay in the ledger, dimmed on request, and in the "dropped by compaction" list of Model saw; the model did not see them after the compaction.

## Model saw

For any event, Estela rebuilds the context the model had at that point on that event's lane, from the log alone. The context is split into slots:

| Slot | Contents |
|---|---|
| System prompt | The system prompt, when the log records it |
| Tools | The tool definitions, when the log records them |
| Summary | The compaction summary that replaced earlier events |
| Messages | The earlier turns still in context |
| This turn | The events of the current turn so far |

Each slot is `present`, `empty`, or `unavailable`. When an agent records the system prompt and tools as snapshots during the session (Claude Code 2.1.268 and later), each slot uses the latest snapshot at or before the event and says which event recorded it (`recorded at #7`). Model saw also lists the recorded token counts and which slots each count covers (a request's input tokens cover all slots), and the events a compaction removed. The result is "complete", or "partial" with the number of unavailable slots.

## `unavailable`: no estimates

When a log does not record something, Estela shows `unavailable` (or "—", or "not recorded") instead of a number or a guess. It never estimates a token count from text length, never splits a request's tokens across slots, and never prices a request whose tokens or model are missing. A blank count is the log's limit, not zero.

## Capabilities

Each agent's reader declares what kind of data its logs can hold: requests, usage, durations, reasoning, compaction, compaction token counts, subagents, system prompt, tool definitions, hooks. A count the agent cannot record shows as "—" in the session header and is listed as `unavailable` by the MCP tools. A declared capability means the agent can record that data, not that every session has it. The table per agent is in [Supported agents](supported-agents.md#what-each-agent-records).

## Trace and trace id

Estela converts a session into a trace: the ordered events plus the session's details. A trace id is an opaque hash of the agent and the path (plus the session id for a `path#sessionId` session). URLs and the MCP tools use trace ids, never file paths.
