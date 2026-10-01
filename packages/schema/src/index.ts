import { traceSchema, type Trace } from './types.ts'

export {
  EVENT_KINDS,
  TRACE_SCHEMA,
  type AgentInfo,
  type Capability,
  type CompactionPayload,
  type ContextSlot,
  type ContextSlotName,
  type ContextTokens,
  type EventKind,
  type PromptSnapshotPayload,
  type ReconstructResult,
  type RequestPayload,
  type SkippedRecord,
  type SourcePointer,
  type ToolCallPayload,
  type ToolResultPayload,
  type Trace,
  type TraceEvent,
  type TraceSession,
  type TruncatedPath,
  type ViewInfo,
} from './types.ts'

export function isTrace(value: unknown): value is Trace {
  return traceSchema.safeParse(value).success
}
