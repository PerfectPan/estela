# Plan 0002: Export a trace to ATIF and OTLP

- Status: in review
- Owner: unconfirmed
- Reviewer: unconfirmed
- Last updated: 2026-10-27
- Paired Spec: [`docs/specs/0002-export-atif-otlp.md`](../specs/0002-export-atif-otlp.md)

This plan adds the two export follow-ups of the retired external-release plan
(section 7): one ATIF v1.8 projection and one OTLP projection of a canonical
trace, each behind a CLI command that loads a session, redacts, and writes
one file. It follows issues #50 (ATIF) and #51 (OTLP).

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

- The canonical trace (`@rivus/agent-trace-schema`) is an event list with
  per-kind payloads; the kit's payload comments name the OTel GenAI attribute
  each field means (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, …).
  `reconstruct(trace, eventId)` is the model-visible surface at an event:
  slots for system, tools, summary, messages, and the current turn.
- Kernel and schema import no `node:*` outside tests, and no workspace
  package imports the kit at runtime except `apps/cli`.
- Harbor's ATIF validator (`src/harbor/utils/trajectory_validator.py`,
  `python -m harbor.utils.trajectory_validator`) checks ATIF v1.8 with
  Pydantic models: extra fields forbidden, `step_id` sequential from 1,
  `source_call_id` must reference a `tool_call_id` of the same step,
  agent-only step fields forbidden on system/user steps, embedded subagents
  need a unique `trajectory_id`. Harbor requires Python >= 3.12.
- The OTel GenAI semantic conventions have no release. The schema URL of the
  `open-telemetry/semantic-conventions-genai` `main` at the time of writing
  is still `gen-ai-dev/1.42.0-dev`, the version the retired plan pinned.
- The three backends all ingest OTLP/JSON spans and map the GenAI
  conventions: Langfuse reads `gen_ai.input.messages` /
  `gen_ai.output.messages` / `gen_ai.system_instructions` /
  `gen_ai.tool.definitions` / `gen_ai.usage.*`, and derives the observation
  type from `gen_ai.operation.name` (`chat` → generation, `execute_tool` →
  tool, `invoke_agent` → agent); Phoenix converts the same attributes to
  OpenInference at ingest and infers the span kind from
  `gen_ai.operation.name`; LangSmith reads the same message attributes and
  `gen_ai.usage.*`, plus the legacy span events. All three accept the OTLP
  HTTP/JSON traces endpoint.
- Redaction is the kit's `redact` / `redactText`, imported by `apps/cli`.

### 1.2 Problem

A trace can be inspected but not taken elsewhere. The canonical model was
designed for both exports (D3 of the retired plan: field meanings follow OTel
GenAI; structure stays mappable to ATIF), so both are projections — but
neither exists.

### 1.3 Goals and success criteria

- Every fixture session of every registered agent exports to an ATIF v1.8
  document that passes Harbor's validator (Spec A2).
- An exported fixture trace decodes as `ExportTraceServiceRequest` (A4) and
  loads in Langfuse, LangSmith, and Phoenix (A5).
- The mapping tables in this plan pin ATIF v1.8 and `gen-ai-dev/1.42.0-dev`.
- All repository gates stay green; the exporters add no `node:*` import to
  kernel.

### 1.4 Non-goals

- A browser export action or RPC for either format.
- The CLI posting to a remote endpoint.
- Importing ATIF or OTLP back into a trace.
- A `dsh` or OpenCode export.
- Rounding token or timing data; totals stay as recorded.

## 2. Outline

### 2.1 Design principles

- An export is a projection: pure, total over every valid `Trace`, no I/O.
- Missing data is omitted, never invented (one exception: ATIF `agent.version`
  required, `"unknown"` when unrecorded).
- Everything exported names the events it came from.

### 2.2 Boundaries and responsibilities

| Piece | Package | Owns |
|---|---|---|
| ATIF projection | `packages/kernel` (`export-atif.ts`) | `Trace` → ATIF v1.8 trajectory object |
| OTLP projection | `packages/kernel` (`export-otlp.ts`) | `Trace` → OTLP/JSON `ExportTraceServiceRequest` object |
| Deterministic ids | `packages/kernel` (`hash-id.ts`) | FNV-1a-based hex ids for span/trace ids |
| Loading, redaction, writing, terminal | `apps/cli` (`export.ts`, `main.ts`, `argv.ts`) | `export-atif` / `export-otlp` commands |
| Fixture validation script | `scripts/validate-exports.mjs` | exports fixtures, runs Harbor's validator |

## 3. Detailed design

### 3.1 Entry points

```
npx @rivus/agent-trace export-atif <path> [--out <file>]
npx @rivus/agent-trace export-otlp <path> [--out <file>]
```

`<path>` is what `build` takes: a canonical agent-trace JSON file or a
session path. `--out` writes to that file (created or truncated); without it,
`agent-trace-<8 chars of session id>.atif.json` / `.otlp.json` in the working
directory. Output is one line (`Wrote <path>`, `~` for home) in plain mode;
clack intro/outro otherwise.

### 3.2 Kernel interfaces

```ts
// packages/kernel: two pure projections
export function toAtif(trace: Trace): AtifTrajectory
export function toOtlp(trace: Trace): OtlpExportTraceRequest
```

Both take a checked `Trace` and return plain objects; the CLI serializes with
`JSON.stringify(value, null, 2)`. The types (`AtifTrajectory`, `Otlp…`) live
beside their exporters and mirror the external schema's fields the export
sets; they are not schemas, and nothing parses these documents back.

`hash-id.ts` gives deterministic ids without `node:crypto`: two salted
FNV-1a 64-bit hashes concatenated for a 16-byte hex trace id, one for an
8-byte span id. Same trace in, same ids out.

### 3.3 ATIF mapping (pinned: ATIF v1.8, Harbor RFC 0001)

Root document:

| Canonical | ATIF |
|---|---|
| `session.id` | `session_id`; also `trajectory_id` on embedded subagents (lane id) |
| `agent`, `agentVersion` | `agent.name`, `agent.version` (`"unknown"` when unrecorded) |
| `session.systemPrompt`, `session.tools` | first `system` step's `message`; `agent.tool_definitions` (array of records only) |
| distinct request `model`s = 1 | `agent.model_name` |
| `skipped`, `capabilities`, `agents`, `source`, `original` | `extra.agent_trace` (skipped count per reason; capabilities; nothing per event — `source`/`original` stay out) |
| — | `notes`: producer note naming this mapping |

Steps (main lane walks `events` in `seq` order; each other lane becomes one
embedded `subagent_trajectories` entry built the same way):

| Canonical | ATIF |
|---|---|
| `user` event | step with `source: "user"`, `message` = `payload.text` (empty string when absent); `meta`/`injected`/`command`/`continued`/`compactSummary` flags → `extra.agent_trace.flags` |
| one `requestId` group on the lane (`assistant`, `reasoning`, `tool_call`, `tool_result`, `request` with that id) | one step with `source: "agent"` |
| `assistant` payload `text` | `message` |
| `reasoning` payload `text` (joined with blank lines) | `reasoning_content` |
| `tool_call` (`callId`, `name`, `args`) | `tool_calls[]`: `tool_call_id`, `function_name`, `arguments` (`args` when a record, else `{}`); `title` → `extra.agent_trace.title` |
| `tool_result` (`callId`, `output`) | `observation.results[]` of the step that holds the matching `tool_call` (`source_call_id`, `content` = `output` when a string, else JSON text); orphan result → `source_call_id` omitted on the current agent step |
| `request` payload | `metrics`: `prompt_tokens` = `usage.inputTokens`, `completion_tokens` = `usage.outputTokens`, `cached_tokens` = `usage.cacheReadTokens`; `metrics.extra.agent_trace`: `cacheWriteTokens`, `reasoningTokens`, `totalTokens`, `cacheWrite1hTokens`, `granularity`, `modelCalls`, `responseId`; `model_name` = `payload.model` when it differs from `agent.model_name`; `llm_call_count` = `modelCalls` when the granularity is `turn`/`session` |
| `compaction` event | `system` step, `message` = the summary text (the `compactSummary` user event `payload.summaryEventId` names, else `"Context compaction performed"`), `observation.results[0].content` = that summary, `extra.context_management = { type: "compaction", boundary: "replace" }`, `extra.agent_trace` carries `trigger`/`preTokens`/`postTokens` |
| events kept across a compaction (before it, not `shadowedBy`) | their steps carry `is_copied_context: true` |
| events `shadowedBy` a compaction | no step |
| `system` event `type: 'prompt_snapshot'` with `systemPrompt` | a `system` step whose `message` is that snapshot text (the first one reuses `session.systemPrompt` when equal) |
| `system` event `type: 'turn_duration'` | no step; `durationMs` → `extra.agent_trace.turnDurationMs` of the step in progress |
| `hook` / `unknown` events | no step; collected into `extra.agent_trace.hooks` / `.unknown` of the step in progress |
| `ts` | `timestamp` (ISO 8601) |
| `durationMs`, `skipped`, `source`, `original`, `requestId`, `agentId` | `extra` (`extra.agent_trace.eventIds` names the step's events; `requestId` on the step's `extra.agent_trace`) |

Step grouping rules: a lane's walk opens an agent step at the first event
that carries a `requestId` (or an ungrouped `assistant`/`tool_call`/
`reasoning`), keeps it open while events with that `requestId` (or ungrouped
message kinds) arrive, and closes it at the next `user`/`system`/
`compaction` event or a new `requestId`. A step with no `request` event gets
no `metrics`. `llm_call_count` is set only from a recorded `modelCalls`.
`final_metrics` sums the root steps' `metrics` (`total_prompt_tokens`,
`total_completion_tokens`, `total_cached_tokens`, `total_steps`).

Subagents: a lane with a `parentId` becomes an embedded trajectory
(`trajectory_id` = lane id, `agent.name` = `trace.agent`, `session_id` =
`session.id`); the step holding the spawn event's lane groups the
`spawnEventId`, and its `observation.results` gains a
`subagent_trajectory_ref: [{ trajectory_id: <lane id>, session_id }]` entry.

### 3.4 OTLP mapping (pinned: semconv `gen-ai-dev/1.42.0-dev`)

One `resourceSpans` with resource attributes `service.name = "agent-trace"`;
one `scopeSpans` with scope `agent-trace`. The JSON follows the OTLP JSON
encoding rules: enums as integers (`span_kind`), hex `traceId`/`spanId`,
nanosecond times as decimal strings.

Ids and times: trace id = hash of `agent + session.id`; span id = hash of
the event id (`invoke_agent` spans: hash of the lane id). Start = `startedAt`
or `ts` (epoch ms → nanoseconds); end = start + `durationMs`, else the next
event's `ts` on the lane capped at the parent's end, else start.

| Canonical | Span / attribute |
|---|---|
| session (main lane) | root span `invoke_agent {agent.name}`, `gen_ai.operation.name = "invoke_agent"`, `gen_ai.agent.name`, `gen_ai.agent.version` when recorded; subagent lanes get their own `invoke_agent` span parented by the spawn event's span when resolvable, else the root |
| `request` event | span `chat {model}`, `gen_ai.operation.name = "chat"`, span kind CLIENT, parent = the lane's `invoke_agent` span; `gen_ai.request.model`, `gen_ai.response.id`, `gen_ai.response.finish_reasons = [finishReason]` when recorded |
| `request.usage` | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens`, `gen_ai.usage.reasoning.output_tokens`; `totalTokens` → `gen_ai.usage.total_tokens`? No — not in the pinned registry; omitted |
| `request` with a compaction before it on the lane | `gen_ai.conversation.compacted = true` |
| `reconstruct(trace, request.id)` | `gen_ai.input.messages` (JSON string of the visible messages slot: `user` → role user, `assistant` → role assistant, `tool_call` → role assistant with a `tool_call` part, `tool_result` → role tool with a `tool_call_response` part, `reasoning` → role assistant with a `reasoning` part), `gen_ai.system_instructions` (JSON string, from the `system` slot's snapshot or the session/lane field), `gen_ai.tool.definitions` (JSON string, from the `tools` slot) |
| events with the request's `requestId` on the lane | `gen_ai.output.messages` (JSON string: the `assistant` event's text and `reasoning` texts as parts, `tool_call`s as `tool_call` parts) |
| `tool_call` event (+ its `tool_result`) | span `execute_tool {name}`, `gen_ai.operation.name = "execute_tool"`, `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` (structured when a record, else the JSON text), parent = the producing request's `chat` span when resolvable; `tool_result.isError` → span status ERROR |
| `system` events, `hook`, `unknown`, `compaction`, `skipped` | no span; a compaction shows as `gen_ai.conversation.compacted` on later requests |

Attribute values follow the pinned registry types: strings, integers,
booleans, string arrays, and structured values as `kvlistValue` / JSON
strings where the registry allows any.

### 3.5 Redaction

The CLI applies the kit's `redact` to the exported object tree (strings
only, home directory → `~`, known token patterns) before writing, unless
`AGENT_TRACE_REDACT=0`. The report rule (always redacted) stays
report-specific: a data export is opt-out because a dataset or backend
ingest may legitimately need the unredacted bytes.

### 3.6 Failures and recovery

| Condition | Behavior |
|---|---|
| Load fails | Exit 1, the load error's message (redacted), no file written |
| Trace with zero steps (no exportable events) | ATIF requires at least one step: the export writes a single `system` step carrying `session.systemPrompt`, or fails with an explanatory message when the trace has none |
| `--out` unwritable | Exit 1 with the IO error's message |

### 3.7 Compatibility and migration

New commands and kernel exports only; nothing changes shape. A changeset on
`@rivus/agent-trace` (minor) records the new capability.

## 4. Rollout and stability

A local tool: ships in the next version, no stages. Rollback is reverting
the PR. Signals are the repository checks and the validator script.

## 5. Verification

- Kernel unit tests: `export-atif.test.ts` (root document, step grouping,
  compaction, subagents, metrics, invariants — step ids sequential,
  `source_call_id` resolves, agent-only fields only on agent steps, embedded
  `trajectory_id` unique) and `export-otlp.test.ts` (span tree, attribute
  names and values, OTLP JSON encoding rules, messages from `reconstruct`).
- CLI test: `export.test.ts` — command wiring on the demo fixture (file
  written, redaction applied, `AGENT_TRACE_REDACT=0` keeps content) and one
  export per registered agent's conformance fixtures through a structural
  ATIF checker, so CI covers A2's shape without Python.
- `scripts/validate-exports.mjs`: exports every registered agent's fixture
  sessions with the CLI and runs Harbor's validator on each output
  (`uv run --python 3.12 --with harbor python -m
  harbor.utils.trajectory_validator <file>`); manual gate, output attached
  to the delivery PR.
- Backend ingest (Spec A5): post an exported fixture to a local Phoenix
  (`arize-phoenix`) and a local Langfuse; LangSmith needs a cloud API key,
  so its ingest is validated against its documented mapping and marked
  skipped-with-reason in the PR if no key is available.

### 5.1 Validation ledger

| Batch | Command or evidence | Expected result |
|---|---|---|
| kernel | `pnpm --filter @rivus/agent-trace-kernel test` | exporter unit tests green |
| cli | `pnpm --filter @rivus/agent-trace test` | export wiring + fixture exports green |
| validator | `node scripts/validate-exports.mjs` | every fixture export passes Harbor's validator |
| backends | PR evidence: Phoenix + Langfuse ingest output | sessions visible with model, messages, usage |
| gates | `node scripts/format.mjs --check`, `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `node scripts/check-layers.mjs`, `node scripts/check-browser-bundle.mjs` | all green |

## 6. Execution plan

### 6.1 Preconditions

Paired Spec reviewed; `harbor` and the semconv versions pinned in section 3
re-checked at implementation time.

### 6.2 Completion contract

Spec A1–A4 have tests; A2 and A5 have recorded evidence; the mapping tables
name ATIF v1.8 and `gen-ai-dev/1.42.0-dev`; all gates green.

### 6.3 Execution order

1. Kernel: `hash-id.ts`, `export-atif.ts`, `export-otlp.ts` + tests.
2. CLI: `argv.ts` commands, `export.ts`, `main.ts` wiring, terminal line,
   `export.test.ts`.
3. `scripts/validate-exports.mjs`, run it, record evidence.
4. Docs: README commands, `AGENTS.md` kernel row, this plan's ledger.
5. Changeset; run all gates; commit.

### 6.4 Rollback per batch

Revert the PR; no persisted data besides the export files users wrote.

## 7. Risks, open questions, and follow-up

| Item | Type | Impact | Owner | Next step |
|---|---|---|---|---|
| GenAI semconv has no release; names can change | risk | Mapping table goes stale | unconfirmed | The table pins `gen-ai-dev/1.42.0-dev`; a semconv release PR updates it deliberately |
| Langfuse/LangSmith mapping drift (their ingestion is independent) | risk | A backend shows fewer fields | unconfirmed | Keep the export on the pinned registry names; report gaps upstream |
| Harbor validator requires Python >= 3.12 | risk | Validator run needs uv | unconfirmed | Script documents the command; CI does not run it |
| ATIF `extra` grows with agent-specific payload fields | follow-up | Larger exports | unconfirmed | Keep only the fields listed in 3.3; extend deliberately |
| Streaming or incremental export | follow-up | Huge sessions | unconfirmed | Separate plan if needed |
