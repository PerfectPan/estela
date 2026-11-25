import type { SessionSummary, SessionTarget } from '@rivus/agent-kit/transcript'
import type { SessionFs } from '@rivus/estela-kernel'
import type { Trace, TraceEvent } from '@rivus/estela-schema'
import type { FileStamp, ReadOriginal } from './source-check.ts'

/** What a `traceId` resolves to. The shell's resolver (its session catalog) supplies it. */
export interface ResolvedSession {
  /** Cache key: one per session (the trace id, or the launch session's `path#id` string outside the dev server). */
  key: string
  /** What the shell loads: a discovered `SessionRef`, or the target of a path given on the command line. */
  target: SessionTarget
  /** Expected file stamp for `target.path`: a load whose file no longer matches throws `SnapshotChangedError` without caching. */
  expect?: FileStamp
}

export interface TraceStoreDeps {
  resolve: (traceId: string) => ResolvedSession | undefined | Promise<ResolvedSession | undefined>
  load: (session: ResolvedSession, opts: LoadOpts) => Promise<LoadedTrace>
  /** Reads for the source-pointer originals: stamps, `checkedOriginal`, and `totalBytes`. */
  fs: SessionFs
  /** Reads one original through its source pointer (compressed files, SQLite rows); defaults to a raw file range. */
  readOriginal?: ReadOriginal
  /**
   * Redaction of everything sent out: view trace, events, reconstructions, and error messages. Omit to send
   * recorded values. An event or lane id `text` would change is shown as an alias (`@e<seq>`, `@l<n>`), and every
   * id input takes an alias back.
   */
  redact?: TraceRedaction
  /** Server log, for conditions the operator should see (a view over budget). */
  log?: (message: string) => void
  /** The view's starting string cap: 4,096 characters by default; `fitView` raises a value below 256 to 256. */
  maxString?: number
}

/** How a reader redacts: a whole value (every string in it) or one string. */
export interface TraceRedaction {
  value: <T>(value: T) => T
  text: (text: string) => string
}

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
