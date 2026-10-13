import type {
  Capability,
  Lane,
  PromptSnapshotPayload as KitPromptSnapshotPayload,
  SourcePointer,
  TranscriptEventKind,
  TranscriptEventOf,
  TranscriptEventPayloads,
  TranscriptSession,
} from '@rivus/agent-kit/transcript'
import * as z from 'zod/mini'

export const TRACE_SCHEMA = 'agent-trace' as const

/**
 * Every event kind, in one place; `EventKind` and `traceEventSchema` both read it. They are the kit's
 * `TranscriptEventKind`: a kind the kit does not have fails here, and a kind the kit adds fails at `payloadSchemas`.
 */
export const EVENT_KINDS = [
  'user',
  'assistant',
  'reasoning',
  'tool_call',
  'tool_result',
  'request',
  'system',
  'compaction',
  'hook',
  'unknown',
] as const satisfies readonly TranscriptEventKind[]

export type EventKind = (typeof EVENT_KINDS)[number]

/** One entry of `Trace.capabilities`: the kit's `Capability`, which the `satisfies` ties it to. */
const capabilitySchema = z.enum([
  'requests',
  'usage',
  'durations',
  'reasoning',
  'compaction',
  'compactionTokens',
  'subagents',
  'systemPrompt',
  'toolSchemas',
  'hooks',
]) satisfies z.ZodMiniType<Capability, Capability>

/**
 * An event's `source`: the kit's `SourcePointer`, which the `satisfies` ties it to. In a view trace `file` is an
 * index into `Trace.sourceFiles`.
 */
const sourcePointerSchema = z.object({
  file: z.string(),
  offset: z.number(),
  length: z.number(),
  line: z.number(),
}) satisfies z.ZodMiniType<SourcePointer, SourcePointer>

/**
 * Path of a value `toView` shortened: object keys as strings, array indexes as
 * numbers. `payload.$truncated` holds these for each shortened event.
 */
export const truncatedPathSchema = z.array(z.union([z.string(), z.number()]))
export type TruncatedPath = z.infer<typeof truncatedPathSchema>

/** What a view trace (`toView`) adds to every payload. */
interface PayloadViewFields {
  /** The paths `toView` shortened in this payload. */
  $truncated?: TruncatedPath[]
}

/** What a view trace adds to a `system` payload besides `$truncated`. */
interface SystemViewFields extends PayloadViewFields {
  /**
   * View traces only: this snapshot's `systemPrompt` equals the one on the
   * named earlier snapshot, which holds the text; `get-event` returns it in full.
   */
  systemPromptSameAs?: string
  /** View traces only: the same for a non-empty `tools`. */
  toolsSameAs?: string
}

/**
 * Each kind's payload: the kit's payload type for that kind, which the kit's adapters produce, plus the fields a
 * view trace adds. Every kit payload keeps the fields an agent adds of its own, which read as `unknown`.
 */
export type TraceEventPayloads = {
  [K in EventKind]: TranscriptEventPayloads[K] & (K extends 'system' ? SystemViewFields : PayloadViewFields)
}

/** A trace event of the kinds in `K`, such as `EventOf<'tool_call'>`; its payload is that kind's. */
export type EventOf<K extends EventKind> = {
  [Kind in K]: Omit<TranscriptEventOf<Kind>, 'payload'> & { payload: TraceEventPayloads[Kind] }
}[K]

/**
 * One event of a trace: the kit's `TranscriptEvent` with view fields on its payload. The union is discriminated by
 * `kind`; narrowing on it types `payload`.
 */
export type TraceEvent = EventOf<EventKind>

export type ToolCallPayload = TraceEventPayloads['tool_call']
export type ToolResultPayload = TraceEventPayloads['tool_result']
export type RequestPayload = TraceEventPayloads['request']
export type CompactionPayload = TraceEventPayloads['compaction']

/**
 * A `system` payload with `type: 'prompt_snapshot'`: the system prompt and tool definitions the agent recorded at
 * that point on the event's lane. A later snapshot on the same lane replaces an earlier one; a field left out was
 * not recorded by that snapshot.
 */
export type PromptSnapshotPayload = KitPromptSnapshotPayload & SystemViewFields

const viewFields = { $truncated: z.optional(z.array(truncatedPathSchema)) }

const usageSchema = z.object({
  inputTokens: z.optional(z.number()),
  outputTokens: z.optional(z.number()),
  totalTokens: z.optional(z.number()),
  cacheReadTokens: z.optional(z.number()),
  cacheWriteTokens: z.optional(z.number()),
  cacheWrite1hTokens: z.optional(z.number()),
  reasoningTokens: z.optional(z.number()),
})

const messagePayloadSchema = z.looseObject({
  text: z.optional(z.string()),
  image: z.optional(z.boolean()),
  mediaType: z.optional(z.string()),
  meta: z.optional(z.boolean()),
  compactSummary: z.optional(z.boolean()),
  command: z.optional(z.boolean()),
  injected: z.optional(z.boolean()),
  continued: z.optional(z.boolean()),
  ...viewFields,
})

const reasoningPayloadSchema = z.looseObject({
  text: z.optional(z.string()),
  redacted: z.optional(z.boolean()),
  ...viewFields,
})

const toolCallPayloadSchema = z.looseObject({
  callId: z.string(),
  name: z.string(),
  title: z.optional(z.string()),
  args: z.optional(z.unknown()),
  ...viewFields,
})

const toolResultPayloadSchema = z.looseObject({
  callId: z.string(),
  output: z.optional(z.unknown()),
  isError: z.optional(z.boolean()),
  exitCode: z.optional(z.number()),
  orphan: z.optional(z.boolean()),
  ...viewFields,
})

const requestPayloadSchema = z.looseObject({
  model: z.optional(z.string()),
  responseId: z.optional(z.string()),
  usage: z.optional(usageSchema),
  startedAt: z.optional(z.number()),
  durationMs: z.optional(z.number()),
  finishReason: z.optional(z.string()),
  granularity: z.optional(z.enum(['request', 'turn', 'session'])),
  modelCalls: z.optional(z.number()),
  usageByModel: z.optional(z.record(z.string(), z.object({ usage: usageSchema, modelCalls: z.optional(z.number()) }))),
  ...viewFields,
})

const systemPayloadSchema = z.looseObject({
  type: z.optional(z.string()),
  text: z.optional(z.string()),
  durationMs: z.optional(z.number()),
  systemPrompt: z.optional(z.string()),
  tools: z.optional(z.array(z.unknown())),
  systemPromptSameAs: z.optional(z.string()),
  toolsSameAs: z.optional(z.string()),
  ...viewFields,
})

const compactionPayloadSchema = z.looseObject({
  trigger: z.optional(z.enum(['auto', 'manual'])),
  preTokens: z.optional(z.number()),
  postTokens: z.optional(z.number()),
  summaryEventId: z.optional(z.string()),
  ...viewFields,
})

const hookPayloadSchema = z.looseObject({
  type: z.string(),
  name: z.optional(z.string()),
  event: z.optional(z.string()),
  exitCode: z.optional(z.number()),
  ...viewFields,
})

const unknownPayloadSchema = z.looseObject({
  type: z.string(),
  ...viewFields,
})

/**
 * The payload schema of each kind, for the JSON that reaches trace from outside the kit (canonical files, the
 * report), which the kit's types cannot check at runtime. Each one declares the kit's fields for that kind and keeps
 * undeclared ones. The `satisfies` ties it to the kit at compile time: its output must be that kind's
 * `TraceEventPayloads` entry, so a declared field the kit narrows or a required field the kit adds fails to compile.
 * `payloads.test.ts` checks the other direction, that every payload of that type passes, so a declared field the kit
 * widens fails there. A new optional kit field passes both, and the loose object keeps it.
 */
export const payloadSchemas = {
  user: messagePayloadSchema,
  assistant: messagePayloadSchema,
  reasoning: reasoningPayloadSchema,
  tool_call: toolCallPayloadSchema,
  tool_result: toolResultPayloadSchema,
  request: requestPayloadSchema,
  system: systemPayloadSchema,
  compaction: compactionPayloadSchema,
  hook: hookPayloadSchema,
  unknown: unknownPayloadSchema,
} satisfies { [K in TranscriptEventKind]: z.ZodMiniType<TraceEventPayloads[K], TraceEventPayloads[K]> }

const eventFields = {
  id: z.string(),
  /** Order within the trace; ties in `ts` keep the log's order. */
  seq: z.number(),
  ts: z.number(),
  agentId: z.optional(z.string()),
  parentId: z.optional(z.string()),
  /** Groups events that belong to one model request. */
  requestId: z.optional(z.string()),
  shadowedBy: z.optional(z.string()),
  source: sourcePointerSchema,
  /** Present in memory and in `get-event`; absent in the view trace. */
  original: z.optional(z.unknown()),
}

export const traceEventSchema = z.discriminatedUnion('kind', [
  z.object({ ...eventFields, kind: z.literal('user'), payload: payloadSchemas.user }),
  z.object({ ...eventFields, kind: z.literal('assistant'), payload: payloadSchemas.assistant }),
  z.object({ ...eventFields, kind: z.literal('reasoning'), payload: payloadSchemas.reasoning }),
  z.object({ ...eventFields, kind: z.literal('tool_call'), payload: payloadSchemas.tool_call }),
  z.object({ ...eventFields, kind: z.literal('tool_result'), payload: payloadSchemas.tool_result }),
  z.object({ ...eventFields, kind: z.literal('request'), payload: payloadSchemas.request }),
  z.object({ ...eventFields, kind: z.literal('system'), payload: payloadSchemas.system }),
  z.object({ ...eventFields, kind: z.literal('compaction'), payload: payloadSchemas.compaction }),
  z.object({ ...eventFields, kind: z.literal('hook'), payload: payloadSchemas.hook }),
  z.object({ ...eventFields, kind: z.literal('unknown'), payload: payloadSchemas.unknown }),
]) satisfies z.ZodMiniType<TraceEvent, TraceEvent>

/** One entry of `Trace.agents`: the kit's `Lane`, which the `satisfies` ties it to. */
const laneSchema = z.object({
  id: z.string(),
  parentId: z.optional(z.string()),
  spawnEventId: z.optional(z.string()),
  title: z.optional(z.string()),
  /** This lane's own system prompt, when the agent records one per lane. */
  systemPrompt: z.optional(z.string()),
}) satisfies z.ZodMiniType<Lane, Lane>

/** `Trace.session`: the kit's `TranscriptSession`, plus the field a view trace adds. */
export interface TraceSession extends TranscriptSession {
  /** Set by `toView` on session fields it shortened; see `TruncatedPath`. */
  $truncated?: TruncatedPath[]
}

const traceSessionSchema = z.object({
  id: z.string(),
  title: z.optional(z.string()),
  cwd: z.optional(z.string()),
  startedAt: z.optional(z.number()),
  endedAt: z.optional(z.number()),
  systemPrompt: z.optional(z.string()),
  tools: z.optional(z.unknown()),
  ...viewFields,
}) satisfies z.ZodMiniType<TraceSession, TraceSession>

/**
 * One entry of `Trace.skipped`: a log record that became no event, named by file and line. The kit's `SkippedRecord`
 * carries a whole source pointer instead; a view trace merges the entries of one file and reason into one.
 */
export const skippedEntrySchema = z.object({
  line: z.number(),
  file: z.string(),
  reason: z.string(),
  /** View traces only: records merged into this entry (same file and reason); `line` is the first. */
  count: z.optional(z.number()),
})
export type SkippedEntry = z.infer<typeof skippedEntrySchema>

export const viewInfoSchema = z.object({
  /** String cap used: 4,096 unless the view would exceed `budgetBytes`. */
  maxString: z.number(),
  /** Set by `fitView`: the byte budget the view was fitted to. */
  budgetBytes: z.optional(z.number()),
  /** Set by `fitView`: false only when even the 256-character floor exceeds the budget. */
  withinBudget: z.optional(z.boolean()),
})
export type ViewInfo = z.infer<typeof viewInfoSchema>

/** The canonical trace. A view trace (`toView`) is one too, with view fields set. */
export interface Trace {
  schema: typeof TRACE_SCHEMA
  /** The coding agent whose log this is, such as `claude-code`: the kit's `Transcript.agent`. */
  agent: string
  /** The agent version the log records: the kit's `Transcript.agentVersion`. */
  agentVersion?: string
  session: TraceSession
  capabilities: Capability[]
  agents: Lane[]
  events: TraceEvent[]
  skipped: SkippedEntry[]
  /**
   * View traces only (`toView`): the distinct source files. Each view event's
   * `source.file` is then its index in this list, as a decimal string.
   */
  sourceFiles?: string[]
  /** View traces only: how `toView` / `fitView` built this view. */
  view?: ViewInfo
}

/**
 * A whole `Trace`, each event's payload checked against its kind. The `satisfies` checks that what it accepts is a
 * `Trace`; `payloads.test.ts` checks the other direction, that every `Trace` passes.
 */
export const traceSchema = z.object({
  schema: z.literal(TRACE_SCHEMA),
  agent: z.string(),
  agentVersion: z.optional(z.string()),
  session: traceSessionSchema,
  capabilities: z.array(capabilitySchema),
  agents: z.array(laneSchema),
  events: z.array(traceEventSchema),
  skipped: z.array(skippedEntrySchema),
  sourceFiles: z.optional(z.array(z.string())),
  view: z.optional(viewInfoSchema),
}) satisfies z.ZodMiniType<Trace, Trace>

export interface ReconstructResult {
  eventId: string
  /** Event ids still on the model-visible surface at `eventId`. */
  visibleIds: string[]
  /**
   * Named slots that could not be recovered from this agent's log
   * (`system`, `tools`, `messages`, …).
   */
  unavailable: string[]
  /** How complete this reconstruction is. */
  completeness: 'full' | 'partial' | 'unavailable'
  /** Context composition at the event, in prompt order. */
  slots?: ContextSlot[]
  /**
   * Token counts the agent recorded, each covering one or more slots together.
   * Never estimated from text length. Empty when the agent recorded none.
   */
  tokens?: ContextTokens[]
  /** Events of the same agent that a compaction before `eventId` removed. */
  removedIds?: string[]
}

export type ContextSlotName = 'system' | 'tools' | 'summary' | 'messages' | 'currentTurn'

export interface ContextSlot {
  name: ContextSlotName
  /**
   * `present`: recorded and non-empty. `empty`: recorded, nothing in it
   * (no compaction yet, for example). `unavailable`: the agent does not record it.
   */
  status: 'present' | 'empty' | 'unavailable'
  /** Visible events in this slot, in order. Empty for `system` and `tools`. */
  eventIds: string[]
  /** `system` and `tools`: the prompt snapshot event this slot's content comes from, when it comes from one. */
  recordedBy?: string
}

export interface ContextTokens {
  /** Slots this count covers together. */
  slots: ContextSlotName[]
  tokens: number
  /** Recorded field the number comes from. */
  from: 'request.inputTokens' | 'compaction.postTokens'
}
