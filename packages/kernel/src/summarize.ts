import type { TraceIO } from './io.ts'
import type { HostAdapter, SessionRef, SessionSummary } from './host.ts'
import { fold, summaryOf } from './fold.ts'

/**
 * Version of the summary numbers (`fold`, `summarize`, and every host parser's counts).
 * Bump it when a number changes meaning or value for the same file; the session index
 * then recomputes every cached summary.
 */
export const SUMMARY_VERSION = 1

/** `adapter.summarize` when the host provides one, otherwise `fold(await load(...))`. */
export async function summarize(
  adapter: HostAdapter,
  ref: SessionRef,
  io: TraceIO,
  opts?: { signal?: AbortSignal },
): Promise<SessionSummary> {
  if (adapter.summarize) {
    return summaryOf(await adapter.summarize(ref, io, opts ?? {}))
  }
  const trace = await adapter.load(ref, io, opts ?? {})
  return summaryOf(fold(trace))
}
