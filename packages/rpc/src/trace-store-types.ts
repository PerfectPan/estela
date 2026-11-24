import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { Trace, TraceEvent } from '@rivus/estela-schema'

export interface LoadedTrace {
  trace: Trace
  /** Canonical JSON: originals live inside the file, so `event` reloads it instead of reading the source pointer. */
  canonical: boolean
}

export interface LoadOpts {
  signal: AbortSignal
  onProgress: (bytes: number) => void
}

export interface LoadProgress {
  bytesRead: number
  totalBytes: number
}

export interface TraceViewResult {
  traceId: string
  /** View trace (`toView`); `trace.view` holds the cap used and whether the view fits the budget. */
  trace: Trace
  summary: SessionSummary
  /** Serialized size of `trace` in bytes. */
  bytes: number
}

/** `get-event` result: the full event, or the reason its original cannot be read back. */
export type EventDetail = TraceEvent & { originalUnavailable?: string }

/** One holder's claim on a load. Releasing the last hold of an unfinished load aborts it. */
export interface LoadHandle {
  cached: boolean
  progress: () => LoadProgress
  onProgress: (listener: (progress: LoadProgress) => void) => () => void
  done: Promise<void>
  release: () => void
}
