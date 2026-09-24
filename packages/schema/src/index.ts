export {
  TRACE_SCHEMA,
  type AgentInfo,
  type Capability,
  type CompactionPayload,
  type EventKind,
  type ReconstructResult,
  type RequestPayload,
  type SourcePointer,
  type ToolCallPayload,
  type ToolResultPayload,
  type Trace,
  type TraceEvent,
  type TraceSession,
} from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isEvent(value: unknown): boolean {
  if (!isRecord(value))
    return false
  const source = value.source
  return typeof value.id === 'string'
    && typeof value.seq === 'number'
    && typeof value.ts === 'number'
    && typeof value.kind === 'string'
    && isRecord(value.payload)
    && isRecord(source)
    && typeof source.file === 'string'
    && typeof source.line === 'number'
    && typeof source.offset === 'number'
    && typeof source.length === 'number'
}

export function isTrace(value: unknown): value is import('./types.ts').Trace {
  if (!isRecord(value))
    return false
  const host = value.host
  const session = value.session
  return value.schema === 'agent-trace'
    && isRecord(host)
    && typeof host.id === 'string'
    && isRecord(session)
    && typeof session.id === 'string'
    && Array.isArray(value.capabilities)
    && Array.isArray(value.agents)
    && Array.isArray(value.events)
    && value.events.every(isEvent)
    && Array.isArray(value.skipped)
}
