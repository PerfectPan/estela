export const TRACE_SCHEMA = 'agent-trace' as const

export type EventKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'request'
  | 'system'
  | 'compaction'
  | 'hook'
  | 'unknown'

/** Fields a host records. A number whose capability is absent is `undefined`, never 0. */
export type Capability =
  | 'requests'
  | 'usage'
  | 'durations'
  | 'thinking'
  | 'compaction'
  | 'compactionTokens'
  | 'subagents'
  | 'systemPrompt'
  | 'toolSchemas'
  | 'hooks'

export interface SourcePointer {
  file: string
  offset: number
  length: number
  line: number
}

export interface TraceEvent {
  id: string
  /** Order within the trace; ties in `ts` keep host order. */
  seq: number
  ts: number
  kind: EventKind
  agentId?: string
  parentId?: string
  /** Groups events that belong to one model request. */
  requestId?: string
  shadowedBy?: string
  payload: Record<string, unknown>
  source: SourcePointer
  /** Present in memory and in `get-event`; absent in the view trace. */
  original?: unknown
}

export interface RequestPayload {
  /** gen_ai.request.model */
  model?: string
  /** gen_ai.response.id */
  responseId?: string
  usage?: {
    /** gen_ai.usage.input_tokens */
    inputTokens?: number
    /** gen_ai.usage.output_tokens */
    outputTokens?: number
    /** gen_ai.usage.cache_read.input_tokens */
    cacheReadTokens?: number
    /** gen_ai.usage.cache_write.input_tokens */
    cacheWriteTokens?: number
    /** gen_ai.usage.reasoning.output_tokens */
    reasoningTokens?: number
  }
  startedAt?: number
  durationMs?: number
  /** gen_ai.response.finish_reasons[0] */
  stopReason?: string
}

export interface CompactionPayload {
  trigger?: 'auto' | 'manual'
  preTokens?: number
  postTokens?: number
  summaryEventId?: string
}

/** gen_ai.tool.call.id, gen_ai.tool.name */
export interface ToolCallPayload {
  callId: string
  name: string
  args?: unknown
}

export interface ToolResultPayload {
  callId: string
  output?: unknown
  isError?: boolean
  exitCode?: number
  orphan?: boolean
}

export interface AgentInfo {
  id: string
  parentId?: string
  spawnEventId?: string
  title?: string
}

export interface TraceSession {
  id: string
  title?: string
  cwd?: string
  startedAt?: number
  endedAt?: number
  systemPrompt?: string
  tools?: unknown
}

export interface Trace {
  schema: typeof TRACE_SCHEMA
  host: { id: string, version?: string }
  session: TraceSession
  capabilities: Capability[]
  agents: AgentInfo[]
  events: TraceEvent[]
  skipped: { line: number, file: string, reason: string }[]
}

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
