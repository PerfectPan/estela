import * as z from 'zod/mini'
import { traceSchema, type Trace } from './types.ts'

export {
  EVENT_KINDS,
  TRACE_SCHEMA,
  traceEventSchema,
  traceSchema,
  type CompactionPayload,
  type ContextSlot,
  type ContextSlotName,
  type ContextTokens,
  type EventKind,
  type EventOf,
  type PromptSnapshotPayload,
  type ReconstructResult,
  type RequestPayload,
  type SkippedEntry,
  type ToolCallPayload,
  type ToolResultPayload,
  type Trace,
  type TraceEvent,
  type TraceEventPayloads,
  type TraceSession,
  type TruncatedPath,
  type ViewInfo,
} from './types.ts'

/**
 * Schema guard: a `value` that passes is the `Trace` itself, so its identity and key order stay as they were (the
 * schemas have no defaults or transforms, and the parse output is not used).
 */
export function isTrace(value: unknown): value is Trace {
  return z.safeParse(traceSchema, value).success
}

/** The first issue of a failed parse as `path: message`, such as `events.3.payload.callId: Invalid input`. */
export function firstIssue(error: z.core.$ZodError): string {
  const issue = error.issues[0]
  if (!issue) {
    return 'invalid input'
  }
  return issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message
}

/** `isTrace` that throws a `TypeError` with `context` and the first issue when `value` is not a `Trace`. */
export function assertTrace(value: unknown, context: string): asserts value is Trace {
  const parsed = z.safeParse(traceSchema, value)
  if (!parsed.success) {
    throw new TypeError(`${context}: ${firstIssue(parsed.error)}`)
  }
}
