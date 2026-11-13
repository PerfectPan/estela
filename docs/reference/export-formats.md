# Export formats

Audience: someone who reads an Estela export with another tool, or changes the export code. This document lists how `estela export-atif` and `estela export-otlp` map a session onto each format. The code is `packages/kernel/src/export-atif.ts`, `export-atif-steps.ts`, and `export-otlp.ts`; how to run the commands is in [Reports and exports](../guide/reports-and-exports.md).

Two rules hold for both formats:

- A value the agent did not record is left out, never written as zero or guessed. The one exception is ATIF's required `agent.version`, which is `"unknown"` when the log records no agent version.
- Events a compaction removed from the model's context produce no ATIF step and no OTLP span of their own.

## Pinned versions

| Format | Version | Where it is pinned | Stability |
|---|---|---|---|
| ATIF | `ATIF-v1.8` ([Harbor RFC 0001](https://github.com/harbor-framework/harbor/blob/main/rfcs/0001-trajectory-format.md)) | `ATIF_SCHEMA_VERSION` in `export-atif.ts` | covered by semver from 1.0 ([public interface](public-interface.md)) |
| OTLP | OTLP/JSON `ExportTraceServiceRequest` with the OpenTelemetry GenAI attributes of `gen-ai-dev/1.42.0-dev` | `OTLP_SEMCONV_VERSION` in `export-otlp.ts` | experimental: the GenAI conventions have no release, so attribute names can change when the pin moves |

A new ATIF or semconv version is adopted on purpose, in its own change that updates the pin, this document, and the tests.

## ATIF

One export is one root trajectory for the main agent. Each subagent lane with at least one exportable event becomes an entry of the root's `subagent_trajectories`, built the same way.

### Trajectory

| Field | Value |
|---|---|
| `schema_version` | `ATIF-v1.8` |
| `session_id` | the session id |
| `trajectory_id` | only on an embedded subagent trajectory: the lane id |
| `agent.name` | the agent id (`claude-code`, `codex`, …) |
| `agent.version` | the recorded agent version, else `"unknown"` |
| `agent.model_name` | the model, when the requests of the trajectory that name a model all name the same one |
| `agent.tool_definitions` | the session's tool list, on the root, when it is a list of objects |
| `steps` | below; `step_id` runs from 1 |
| `notes` | a fixed note: where the export came from, that `extra.estela.eventIds` names each step's events, the compaction rule, and that `cost_usd` is a list price |
| `final_metrics` | `total_prompt_tokens`, `total_completion_tokens`, `total_cached_tokens` (sums over the steps that record them), `total_steps`, and `total_cost_usd` (below) |
| `extra.estela` (root only) | `capabilities`, `skipped` (count per reason of the log records the reader skipped), `pricing` (below), and the hook, unknown-event, turn-duration, and prompt-snapshot entries that came before any step |

### Steps

A lane's events are read in order. A user, system, or compaction event closes the open agent step. Agent events (`assistant`, `reasoning`, `tool_call`, `request`) with the same `requestId` form one agent step.

| Event | ATIF |
|---|---|
| the session's or lane's system prompt | a first `system` step with that text |
| `user` | a `user` step; `message` is the text (empty when none); the flags `meta`, `compactSummary`, `command`, `injected`, `continued` go to `extra.estela.flags` |
| `assistant` | the agent step's `message` (several texts joined by a blank line) |
| `reasoning` | the agent step's `reasoning_content` |
| `tool_call` | `tool_calls[]`: `tool_call_id`, `function_name`, `arguments` (the recorded object; any other value as `{ "input": … }`); a tool title goes to the call's `extra.estela.title` |
| `tool_result` | `observation.results[]` on the step that holds its call, with `source_call_id`; `content` is the output text, or its JSON when it is not text; `isError`, `exitCode`, and `orphan` go to the result's `extra.estela`. A result without a call in the trajectory has no `source_call_id` |
| `request` | the agent step's `metrics` (below), and `model_name` when it differs from `agent.model_name` |
| `compaction` | a `system` step whose `message` is the compaction summary (or `Context compaction performed` when none is recorded), with the summary also as `observation.results[0].content`, `extra.context_management = { "type": "compaction", "boundary": "replace" }`, and `trigger`, `preTokens`, `postTokens` in `extra.estela.compaction` |
| a prompt snapshot with a new system prompt | a `system` step with that text; an unchanged one only adds its id to the open step's extras |
| a `system` event with text | a `system` step |
| a turn duration | `extra.estela.turnDurationMs` of the open step |
| `hook`, `unknown`, other `system` events | no step; listed in the open step's `extra.estela.hooks` or `extra.estela.unknown` |
| an event a compaction hid | no step |
| a step before a later compaction on its lane | `is_copied_context: true` |
| every step | `timestamp` (ISO 8601, its first event), `extra.estela.eventIds` (the canonical event ids), and `extra.estela.requestId` when grouped |

A subagent's spawn step gets an `observation.results[]` entry with `subagent_trajectory_ref: [{ trajectory_id: <lane id>, session_id }]` (and the spawn call's `source_call_id` when the spawn event is a tool call). A subagent lane with no exportable events is left out, with its reference.

A trace with no user, agent, or system-prompt content cannot produce a step, and the export fails with that reason.

### Metrics and cost

| Request field | ATIF |
|---|---|
| `usage.inputTokens` (cache reads and writes included) | `metrics.prompt_tokens` |
| `usage.outputTokens` | `metrics.completion_tokens` |
| `usage.cacheReadTokens` | `metrics.cached_tokens` |
| `usage.cacheWriteTokens`, `cacheWrite1hTokens`, `reasoningTokens`, `totalTokens`, `granularity`, `modelCalls`, `responseId` | `metrics.extra.estela` |
| `modelCalls` when `granularity` is `turn` or `session` | `llm_call_count` |
| list price of the request | `metrics.cost_usd`, only when the request is priced |

`final_metrics.total_cost_usd` is set only when every request of that trajectory's lane is priced; on the root it covers the whole session, subagents included, as ATIF defines it. Requests a compaction hid count toward this rule although they produce no step. The root's `extra.estela.pricing` is `{ "version": <price snapshot version>, "unpricedRequests": <count> }`. Pricing rules are in [Cost](../guide/workspace.md#cost).

## OTLP

The file is one OTLP/JSON `ExportTraceServiceRequest` with one `resourceSpans` (resource attribute `service.name = "estela"`) and one `scopeSpans` (scope `estela`). It follows the OTLP JSON encoding: span kinds as integers, trace and span ids as hex, times as nanoseconds in decimal strings. Ids are hashes of the agent, session, lane, and event ids, so the same session exports to the same ids.

| Source | Span and attributes |
|---|---|
| each lane with events | `invoke_agent <name>` (kind INTERNAL): `gen_ai.operation.name = "invoke_agent"`, `gen_ai.agent.name` (the agent id for the main lane, the lane title for a subagent), `gen_ai.agent.version` when recorded, `gen_ai.conversation.id` (session id). A subagent span's parent is its spawn event's span when that exists, else its parent lane's span. It runs from the lane's first to its last event |
| each `request` | `chat <model>` (kind CLIENT), child of its lane span: `gen_ai.operation.name = "chat"`, `gen_ai.request.model`, `gen_ai.response.id`, `gen_ai.response.finish_reasons`, each when recorded. Start is the recorded start time, else the event time; end is start plus the recorded duration |
| the request's usage | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_write.input_tokens`, `gen_ai.usage.reasoning.output_tokens`, each when recorded. A total token count has no attribute in the pinned registry and is left out |
| what the model saw at the request (`reconstruct`) | `gen_ai.input.messages` (the visible user, assistant, system-text, reasoning, tool-call, and tool-result events as GenAI messages), `gen_ai.system_instructions`, and `gen_ai.tool.definitions`, as JSON strings, each only when recorded |
| the request's own output events | `gen_ai.output.messages` (JSON string) |
| a compaction earlier on the lane | `gen_ai.conversation.compacted = true` |
| each `tool_call` | `execute_tool <name>` (kind CLIENT), child of its request's `chat` span when one exists, else the lane span: `gen_ai.tool.name`, `gen_ai.tool.call.id`, `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result` (JSON strings). A result with `isError` sets the span status to ERROR. It ends at the result's time |
| `system`, `hook`, `unknown`, `compaction` events, skipped records | no span |

The OTLP export carries no cost: the pinned semantic conventions define no cost attribute.

## Checks

- `packages/kernel/src/export-atif.test.ts`, `export-atif-cost.test.ts`, and `export-otlp.test.ts` test the mappings on synthetic traces.
- `apps/cli/src/export/write-export.test.ts` exports the demo trace and every registered agent's conformance fixtures through a structural ATIF check, in CI.
- `node scripts/validate-exports.mjs` exports the same fixtures and runs Harbor's validator (`python -m harbor.utils.trajectory_validator`, Python 3.12 through uv). It needs the network and runs by hand, not in CI.
