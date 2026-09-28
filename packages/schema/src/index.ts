import { traceSchema, type Trace } from './types.ts'

export {
  EVENT_KINDS,
  TRACE_SCHEMA,
  type AgentInfo,
  type Capability,
  type CompactionPayload,
  type EventKind,
  type ReconstructResult,
  type RequestPayload,
  type SkippedEntry,
  type SourcePointer,
  type ToolCallPayload,
  type ToolResultPayload,
  type Trace,
  type TraceEvent,
  type TraceSession,
} from './types.ts'

export function isTrace(value: unknown): value is Trace {
  return traceSchema.safeParse(value).success
}
