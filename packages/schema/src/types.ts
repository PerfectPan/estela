export const TRACE_SCHEMA = 'agent-trace/v0' as const

export type EventKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'system'
  | 'compaction'
  | 'unknown'

export interface TraceSession {
  id: string
  cwd?: string
  title?: string
}

export interface TraceEvent {
  /** Stable id inside this trace. */
  id: string
  /** Epoch milliseconds. */
  ts: number
  kind: EventKind
  /** Tree / sidechain parent. Absent on the root timeline. */
  parentId?: string
  /** Sub-agent identity when the host has one. */
  agentId?: string
  /**
   * Id of a later `compaction` (or host-equivalent) event that removed this
   * event from the model-visible surface. The event stays in `events[]`.
   */
  shadowedBy?: string
  /** Normalized, JSON-safe payload. Never invent keys. */
  payload: Record<string, unknown>
  /** Host-native record for inspector drill-down. */
  original: unknown
}

export interface Trace {
  schema: typeof TRACE_SCHEMA
  host: string
  session: TraceSession
  events: TraceEvent[]
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
}
