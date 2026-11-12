import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { fingerprint } from './source-check.ts'

/** The part of a cached entry a reload needs: its promise, and the pin held by a running `withEvents`. */
export interface Reloadable {
  pinned: number
  /** The reload in flight; shared by concurrent readers and dropped when it settles (or the last pin ends). */
  reload?: Promise<Trace>
}

/**
 * Start or join the reload of a canonical or compressed file, which keeps its originals in the file.
 * One load serves every reader; it is dropped once it settles unless a `withEvents` call pins it.
 */
export function reloadShared(entry: Reloadable, load: () => Promise<{ trace: Trace }>): Promise<Trace> {
  if (!entry.reload) {
    const reload = load().then(loaded => loaded.trace)
    entry.reload = reload
    const clear = (): void => {
      if (entry.reload === reload && entry.pinned === 0) {
        entry.reload = undefined
      }
    }
    reload.then(clear, clear)
  }
  return entry.reload
}

/**
 * A reload started by the first read, not by the caller. A failed reload resolves to `undefined`, so
 * the batch falls back to per-event reads, which mark what they could not read unavailable.
 */
export function reloadOnce(start: () => Promise<Trace>): () => Promise<Trace | undefined> {
  let attempt: Promise<Trace | undefined> | undefined
  return () => {
    attempt ??= start().catch(() => undefined)
    return attempt
  }
}

export type ReloadedRecord = { event: TraceEvent; original: unknown } | { event: TraceEvent; unavailable: string }

/**
 * A compressed log's record from the reloaded trace. The whole file was decompressed once for the
 * batch; the fingerprint taken at load says whether the record read now is still that record.
 */
export function compressedRecord(
  cached: Trace,
  reloaded: Trace,
  byId: Map<string, number>,
  prints: Uint32Array,
  id: string,
  traceId: string,
): ReloadedRecord {
  const index = byId.get(id)
  if (index === undefined) {
    throw new Error(`no event ${id} in ${traceId}`)
  }
  const event = cached.events[index]!
  const again = reloaded.events[index]?.id === id ? reloaded.events[index] : reloaded.events.find(one => one.id === id)
  if (again === undefined) {
    return { event, unavailable: `${event.source.file} changed since it was loaded; line ${event.source.line} is gone` }
  }
  // Compressed lines are fingerprinted whole (nested `data` included), as `fingerprints` does.
  if (fingerprint(again.original, true) !== prints[index]!) {
    return {
      event,
      unavailable: `${event.source.file} changed since it was loaded; line ${event.source.line} holds a different record`,
    }
  }
  return { event, original: again.original }
}

/** A canonical file keeps originals inside it: the record at `index`, matched by id if the file moved it. */
export function canonicalRecord(trace: Trace, cached: Trace, index: number): unknown {
  const id = cached.events[index]!.id
  return (trace.events[index]?.id === id ? trace.events[index] : trace.events.find(event => event.id === id))?.original
}
