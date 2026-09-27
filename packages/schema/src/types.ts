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
  usage: z.optional(z.object({
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
  })),
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

export const agentInfoSchema = z.object({
  id: z.string(),
  parentId: z.optional(z.string()),
  spawnEventId: z.optional(z.string()),
  title: z.optional(z.string()),
})
export type AgentInfo = z.infer<typeof agentInfoSchema>

export const traceSessionSchema = z.object({
  id: z.string(),
  title: z.optional(z.string()),
  cwd: z.optional(z.string()),
  startedAt: z.optional(z.number()),
  endedAt: z.optional(z.number()),
  systemPrompt: z.optional(z.string()),
  tools: z.optional(z.unknown()),
})
export type TraceSession = z.infer<typeof traceSessionSchema>

export const skippedEntrySchema = z.object({
  line: z.number(),
  file: z.string(),
  reason: z.string(),
})
export type SkippedEntry = z.infer<typeof skippedEntrySchema>

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
  skipped: z.array(skippedEntrySchema),
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
  /** Recorded request input tokens. Absent when the host did not record them. */
  inputTokens?: number
  /** Compaction `postTokens` when this is the first request after that compaction. */
  postTokens?: number
}
