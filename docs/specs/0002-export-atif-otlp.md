# Spec 0002: Export a trace to ATIF and OTLP

## Status

Draft

Paired Plan: [`docs/plans/0002-export-atif-otlp.md`](../plans/0002-export-atif-otlp.md)

## Problem And Scope

A canonical trace cannot leave the tool: tools that take the Agent Trajectory
Interchange Format (ATIF v1.8), such as Harbor's evaluation and datasets, and
tracing backends that ingest OpenTelemetry (Langfuse, LangSmith, Phoenix) have
no import path. This Spec adds two export projections of a canonical trace,
each as one CLI command writing one file:

- `export-atif` writes the trace as one ATIF v1.8 trajectory document, with
  the field mapping of the retired external-release plan's appendix A.8;
  fields ATIF has no place for go to `extra`.
- `export-otlp` writes the trace as one OTLP/JSON `ExportTraceServiceRequest`
  whose spans carry OpenTelemetry GenAI semantic-convention attributes; the
  mapping table pins the semconv version it maps to.

Excluded: no UI export action, no RPC, no sending to a remote endpoint from
the CLI (the user posts the file), no import of ATIF or OTLP, no streaming or
incremental export, no new package.

## Behavioral Requirements

- `estela export-atif <path> [--out <file>]` and
  `estela export-otlp <path> [--out <file>]` load the session at `path`
  (a canonical Estela JSON file, or a session path a registered agent
  adapter accepts) exactly once and write the export to `--out`, or to
  `estela-<first 8 characters of the session id>.atif.json` /
  `.otlp.json` in the working directory when `--out` is omitted. On success
  the command prints the written path (with `~` for the home directory) and
  exits 0. On load failure it exits 1 with the load error's message.
- The ATIF export is a document valid against ATIF v1.8: `schema_version`,
  `agent` (`name`, `version`), a `steps` array with sequential `step_id`
  starting at 1, and embedded `subagent_trajectories` each valid as its own
  trajectory with a unique `trajectory_id`.
- Events a compaction removed (`shadowedBy`) produce no ATIF step. Events
  kept across a compaction produce steps marked `is_copied_context: true`,
  and the compaction itself produces a `system` step whose
  `extra.context_management` is `{ type: "compaction", boundary: "replace" }`.
- A subagent lane becomes an embedded `subagent_trajectories` entry, and the
  step of its spawn event carries an `observation.results[]` entry with a
  `subagent_trajectory_ref` that resolves to it (`trajectory_id`).
- The OTLP export is one OTLP/JSON `ExportTraceServiceRequest` whose spans
  carry the OpenTelemetry GenAI attributes of the pinned semconv version
  (`gen-ai-dev/1.42.0-dev`): per model request a `chat` span with
  `gen_ai.request.model`, `gen_ai.response.id`, `gen_ai.response.finish_reasons`,
  and the `gen_ai.usage.*` counts the agent recorded; per tool call an
  `execute_tool` span with `gen_ai.tool.name` and `gen_ai.tool.call.id`; one
  `invoke_agent` span per agent lane; per request the model-visible messages
  as `gen_ai.input.messages` / `gen_ai.output.messages` (JSON strings), the
  recorded system prompt and tool list as `gen_ai.system_instructions` /
  `gen_ai.tool.definitions`, and `gen_ai.conversation.compacted: true` on
  requests after a compaction.
- The mapping table for each format names the external version it maps to:
  ATIF v1.8, and the OTel GenAI semconv schema version
  `gen-ai-dev/1.42.0-dev`. Attribute and field names are exactly those
  versions'.
- A field the agent did not record is omitted from the export, never zero and
  never invented; `agent.version` is the one exception, `"unknown"` when the
  log records no agent version, because ATIF requires the field.
- Both exports are redacted by default, whatever the source: the same
  redaction the report uses (`ESTELA_REDACT=0` opts out). Errors that
  reach the terminal keep the redaction the shell already applies.
- Unit tests cover the mapping rules on synthetic traces, and every
  registered agent's fixture sessions export to a document that passes the
  structural checks of that format.

## Domain Invariants

- The exporters are pure projections over a `Trace` in the kernel: no
  `node:*` import, no I/O, no kit import at runtime. The CLI loads, redacts,
  and writes.
- Missing data is `unavailable`: an export omits what the agent did not
  record. The exporters never estimate or default a count, a time, or a text.
- Every exported fact stays traceable to the event it came from: an ATIF
  step names its canonical event ids in `extra.estela.eventIds`.
- Unknown data fails loud at load, as everywhere else; the exporters only see
  a checked `Trace`.

## Acceptance Examples

### A1: Demo fixture exports to valid ATIF

- Given the demo fixture `fixtures/demo.trace.json`,
- When `export-atif` writes it,
- Then the document passes Harbor's ATIF validator
  (`python -m harbor.utils.trajectory_validator`), the compaction is a system
  step with `extra.context_management`, the events it shadowed produce no
  step, and any kept pre-compaction steps carry `is_copied_context: true`.

### A2: Every registered agent's fixtures export to valid ATIF

- Given the conformance fixture sessions of every registered agent
  (claude-code, codex, dsh, gemini-cli, grok, opencode, pi),
- When each session is exported with `export-atif`,
- Then every document passes Harbor's ATIF validator.

### A3: Subagents export embedded and referenced

- Given a fixture session with a subagent lane,
- When exported with `export-atif`,
- Then the root trajectory carries `subagent_trajectories` with one embedded
  trajectory per lane, its `trajectory_id` is unique, and the spawn step's
  `observation` references it by `trajectory_id`.

### A4: OTLP export decodes as an OTLP/JSON request

- Given any fixture session,
- When exported with `export-otlp`,
- Then the file decodes as an `ExportTraceServiceRequest` with the OTLP
  JSON encoding rules (integer enums, hex ids, string nanosecond times), and
  the chat spans carry the pinned `gen_ai.*` attributes with the values the
  trace recorded.

### A5: OTLP export loads in Langfuse, LangSmith, and Phoenix

- Given an exported fixture trace in OTLP/JSON,
- When it is posted to each backend's OTLP traces endpoint,
- Then each backend ingests it: the session appears with the agent,
  model, messages, tool calls, and usage the trace records.

## Compatibility And Constraints

- Public API: two new CLI commands; the kernel exports two new pure
  functions (`toAtif`, `toOtlp`). Nothing existing changes shape.
- Persisted data: the export file the user asked for; nothing else is
  written.
- Configuration: `--out`; `ESTELA_REDACT=0` opts out of redaction.
- Operational bounds: the export runs on a loaded trace, so the memory
  profile is the load's (the 355 MB session loads in about 1.7 s); the
  written file is the size of the projected data.

## Acceptance Evidence

- Scenario IDs and corresponding tests:
  A1, A3 → kernel `export-atif.test.ts`; A2 → CLI fixture export test plus
  the Harbor validator run recorded in the delivery PR; A4 → kernel
  `export-otlp.test.ts`; A5 → backend ingest run recorded in the delivery PR.
- Runtime or package evidence: `scripts/validate-exports.mjs` exports every
  registered agent's fixture sessions and validates the ATIF output with
  Harbor's validator (Python, run locally); its output is attached to the
  delivery PR.
