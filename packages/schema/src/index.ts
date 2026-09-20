export {
  TRACE_SCHEMA,
  type EventKind,
  type ReconstructResult,
  type Trace,
  type TraceEvent,
  type TraceSession,
} from './types.ts'

export function isTrace(value: unknown): value is import('./types.ts').Trace {
  if (value == null || typeof value !== 'object')
    return false
  const v = value as Record<string, unknown>
  return v.schema === 'agent-trace/v0'
    && typeof v.host === 'string'
    && Array.isArray(v.events)
}
