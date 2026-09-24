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

const EVENT_KINDS = new Set([
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
])

function isEvent(value: unknown): boolean {
  if (!isRecord(value))
    return false
  const source = value.source
  return typeof value.id === 'string'
    && typeof value.seq === 'number'
    && typeof value.ts === 'number'
    && typeof value.kind === 'string'
    && EVENT_KINDS.has(value.kind)
    && isRecord(value.payload)
    && isRecord(source)
    && typeof source.file === 'string'
    && typeof source.line === 'number'
    && typeof source.offset === 'number'
    && typeof source.length === 'number'
}

function isAgent(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string'
    && (value.parentId === undefined || typeof value.parentId === 'string')
}

function isSkipped(value: unknown): boolean {
  return isRecord(value)
    && typeof value.line === 'number'
    && typeof value.file === 'string'
    && typeof value.reason === 'string'
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
    && value.capabilities.every(item => typeof item === 'string')
    && Array.isArray(value.agents)
    && value.agents.every(isAgent)
    && Array.isArray(value.events)
    && value.events.every(isEvent)
    && Array.isArray(value.skipped)
    && value.skipped.every(isSkipped)
}
