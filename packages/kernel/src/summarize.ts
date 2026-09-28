import type { TraceIO } from './io.ts'
import type { HostAdapter, SessionRef, SessionSummary } from './host.ts'
import { fold, summaryOf } from './fold.ts'

/** `adapter.summarize` when the host provides one, otherwise `fold(await load(...))`. */
export async function summarize(
  adapter: HostAdapter,
  ref: SessionRef,
  io: TraceIO,
  opts?: { signal?: AbortSignal },
): Promise<SessionSummary> {
  if (adapter.summarize)
    return summaryOf(await adapter.summarize(ref, io, opts ?? {}))
  const trace = await adapter.load(ref, io, opts ?? {})
  return summaryOf(fold(trace))
}
