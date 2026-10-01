import * as z from 'zod/mini'

export const TRACE_SCHEMA = 'agent-trace' as const

/** Every event kind, in one place; `EventKind` and `traceSchema` both read it. */
export const EVENT_KINDS = [
  'user',
  'assistant',
  'thinking',
  'tool_call',
  'tool_result',
  'request',
  'system',
  'compaction',
  'hook',
  'unknown',
] as const

export const eventKindSchema = z.enum(EVENT_KINDS)
export type EventKind = z.infer<typeof eventKindSchema>

/** Fields a host records. A number whose capability is absent is `undefined`, never 0. */
export const CAPABILITIES = [
  'requests',
  'usage',
  'durations',
  'thinking',
  'compaction',
  'compactionTokens',
  'subagents',
  'systemPrompt',
  'toolSchemas',
  'hooks',
] as const

export const capabilitySchema = z.enum(CAPABILITIES)
export type Capability = z.infer<typeof capabilitySchema>

export const sourcePointerSchema = z.object({
  file: z.string(),
  offset: z.number(),
  length: z.number(),
  line: z.number(),
})
export type SourcePointer = z.infer<typeof sourcePointerSchema>

export const traceEventSchema = z.object({
  id: z.string(),
  /** Order within the trace; ties in `ts` keep host order. */
  seq: z.number(),
  ts: z.number(),
  kind: eventKindSchema,
  agentId: z.optional(z.string()),
  parentId: z.optional(z.string()),
  /** Groups events that belong to one model request. */
  requestId: z.optional(z.string()),
  shadowedBy: z.optional(z.string()),
  payload: z.record(z.string(), z.unknown()),
  source: sourcePointerSchema,
  /** Present in memory and in `get-event`; absent in the view trace. */
  original: z.optional(z.unknown()),
})
export type TraceEvent = z.infer<typeof traceEventSchema>

export const requestPayloadSchema = z.object({
  /** gen_ai.request.model */
  model: z.optional(z.string()),
  /** gen_ai.response.id */
  responseId: z.optional(z.string()),
  usage: z.optional(
    z.object({
      /** gen_ai.usage.input_tokens — total input, including cached tokens. cacheReadTokens and cacheWriteTokens are breakdowns. */
      inputTokens: z.optional(z.number()),
      /** gen_ai.usage.output_tokens */
      outputTokens: z.optional(z.number()),
      /** gen_ai.usage.cache_read.input_tokens */
      cacheReadTokens: z.optional(z.number()),
      /** gen_ai.usage.cache_write.input_tokens */
      cacheWriteTokens: z.optional(z.number()),
      /** gen_ai.usage.reasoning.output_tokens */
      reasoningTokens: z.optional(z.number()),
    }),
  ),
  startedAt: z.optional(z.number()),
  durationMs: z.optional(z.number()),
  /** gen_ai.response.finish_reasons[0] */
  stopReason: z.optional(z.string()),
})
export type RequestPayload = z.infer<typeof requestPayloadSchema>

export const compactionPayloadSchema = z.object({
  trigger: z.optional(z.enum(['auto', 'manual'])),
  preTokens: z.optional(z.number()),
  postTokens: z.optional(z.number()),
  summaryEventId: z.optional(z.string()),
})
export type CompactionPayload = z.infer<typeof compactionPayloadSchema>

/** gen_ai.tool.call.id, gen_ai.tool.name */
export const toolCallPayloadSchema = z.object({
  callId: z.string(),
  name: z.string(),
  args: z.optional(z.unknown()),
})
export type ToolCallPayload = z.infer<typeof toolCallPayloadSchema>

export const toolResultPayloadSchema = z.object({
  callId: z.string(),
  output: z.optional(z.unknown()),
  isError: z.optional(z.boolean()),
  exitCode: z.optional(z.number()),
  orphan: z.optional(z.boolean()),
})
export type ToolResultPayload = z.infer<typeof toolResultPayloadSchema>

/**
 * A `system` event with `type: 'prompt_snapshot'`: the system prompt and tool
 * definitions the host recorded at that point on the event's lane. A later
 * snapshot on the same lane replaces an earlier one; a field left out was not
 * recorded by that snapshot.
 */
export const promptSnapshotPayloadSchema = z.object({
  type: z.literal('prompt_snapshot'),
  systemPrompt: z.optional(z.string()),
  tools: z.optional(z.array(z.unknown())),
  /**
   * View traces only: this snapshot's `systemPrompt` equals the one on the
   * named earlier snapshot, which holds the text; `get-event` returns it in full.
   */
  systemPromptSameAs: z.optional(z.string()),
  /** View traces only: the same for a non-empty `tools`. */
  toolsSameAs: z.optional(z.string()),
})
export type PromptSnapshotPayload = z.infer<typeof promptSnapshotPayloadSchema>

export const agentInfoSchema = z.object({
  id: z.string(),
  parentId: z.optional(z.string()),
  spawnEventId: z.optional(z.string()),
  title: z.optional(z.string()),
  /** This agent's own system prompt, when the host records one per lane. */
  systemPrompt: z.optional(z.string()),
})
export type AgentInfo = z.infer<typeof agentInfoSchema>

/**
 * Path of a value `toView` shortened: object keys as strings, array indexes as
 * numbers. `payload.$truncated` holds these for each shortened event.
 */
export const truncatedPathSchema = z.array(z.union([z.string(), z.number()]))
export type TruncatedPath = z.infer<typeof truncatedPathSchema>

export const traceSessionSchema = z.object({
  id: z.string(),
  title: z.optional(z.string()),
  cwd: z.optional(z.string()),
  startedAt: z.optional(z.number()),
  endedAt: z.optional(z.number()),
  systemPrompt: z.optional(z.string()),
  tools: z.optional(z.unknown()),
  /** Set by `toView` on session fields it shortened; see `TruncatedPath`. */
  $truncated: z.optional(z.array(truncatedPathSchema)),
})
export type TraceSession = z.infer<typeof traceSessionSchema>

export const skippedRecordSchema = z.object({
  line: z.number(),
  file: z.string(),
  reason: z.string(),
  /** View traces only: records merged into this entry (same file and reason); `line` is the first. */
  count: z.optional(z.number()),
})
export type SkippedRecord = z.infer<typeof skippedRecordSchema>

export const viewInfoSchema = z.object({
  /** String cap used: 4,096 unless the view would exceed `budgetBytes`. */
  maxString: z.number(),
  /** Set by `fitView`: the byte budget the view was fitted to. */
  budgetBytes: z.optional(z.number()),
  /** Set by `fitView`: false only when even the 256-character floor exceeds the budget. */
  withinBudget: z.optional(z.boolean()),
})
export type ViewInfo = z.infer<typeof viewInfoSchema>

/**
 * The canonical trace. Payloads stay loose records: their typed shapes above
 * describe what hosts write, but a trace is not rejected for payload content.
 */
export const traceSchema = z.object({
  schema: z.literal(TRACE_SCHEMA),
  host: z.object({ id: z.string(), version: z.optional(z.string()) }),
  session: traceSessionSchema,
  capabilities: z.array(capabilitySchema),
  agents: z.array(agentInfoSchema),
  events: z.array(traceEventSchema),
  skipped: z.array(skippedRecordSchema),
  /**
   * View traces only (`toView`): the distinct source files. Each view event's
   * `source.file` is then its index in this list, as a decimal string.
   */
  sourceFiles: z.optional(z.array(z.string())),
  /** View traces only: how `toView` / `fitView` built this view. */
  view: z.optional(viewInfoSchema),
})
export type Trace = z.infer<typeof traceSchema>

export interface ReconstructResult {
  eventId: string
  /** Event ids still on the model-visible surface at `eventId`. */
  visibleIds: string[]
  /**
   * Named slots that could not be recovered from this host's log
   * (`system`, `tools`, `messages`, …).
   */
  unavailable: string[]
  /** How complete this reconstruction is. */
  completeness: 'full' | 'partial' | 'unavailable'
  /** Context composition at the event, in prompt order. */
  slots?: ContextSlot[]
  /**
   * Token counts the host recorded, each covering one or more slots together.
   * Never estimated from text length. Empty when the host recorded none.
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
   * (no compaction yet, for example). `unavailable`: the host does not record it.
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
