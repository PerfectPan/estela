import type { FittedView, SessionFs } from '@rivus/estela-kernel'
import type { Trace } from '@rivus/estela-schema'
import type { ResolvedSession, LoadedTrace } from './trace-store-types.ts'
import type { FileStamp } from './source-check.ts'
import { fingerprints, stampFiles } from './source-check.ts'
import { withoutOriginals, type Reloadable } from './original-reload.ts'

const CAPACITY = 3 // Loaded traces kept in memory, without originals.

/** One loaded trace a store keeps. */
export interface TraceEntry extends Reloadable {
  session: ResolvedSession
  trace: Trace
  canonical: boolean
  /** A compressed log's events read through the platform reader, one whole-file decompression per load. */
  compressed: boolean
  byId: Map<string, number>
  stamps: Map<string, FileStamp>
  prints: Uint32Array
  /** The view, built on first ask and kept. */
  view?: FittedView
  /** Aborts the reload when the entry is evicted. */
  evicted: AbortController
}

/**
 * The last traces a store loaded, without originals, least recently used first. One that falls out has its
 * reload aborted.
 */
export class TraceCache {
  private readonly fs: SessionFs
  private readonly entries = new Map<string, TraceEntry>()

  constructor(fs: SessionFs) {
    this.fs = fs
  }

  /** Keys of the cached traces, least recently used first. */
  cachedKeys(): string[] {
    return [...this.entries.keys()]
  }

  /** The cached entry for `key`, which becomes the most recently used; `undefined` when it is not cached. */
  get(key: string): TraceEntry | undefined {
    const entry = this.entries.get(key)
    if (entry) {
      this.entries.delete(key)
      this.entries.set(key, entry)
    }
    return entry
  }

  /** Keep `entry` in place of the one its key already has, and drop the least recently used beyond the capacity. */
  add(entry: TraceEntry): void {
    this.entries.get(entry.session.key)?.evicted.abort()
    this.entries.delete(entry.session.key)
    this.entries.set(entry.session.key, entry)
    while (this.entries.size > CAPACITY) {
      const [key, oldest] = this.entries.entries().next().value!
      oldest.evicted.abort()
      this.entries.delete(key)
    }
  }

  /** The cache entry of a loaded trace: no originals, event ids indexed, and source files stamped. */
  async of(session: ResolvedSession, loaded: LoadedTrace): Promise<TraceEntry> {
    const prints = fingerprints(loaded.trace)
    const trace = withoutOriginals(loaded.trace)
    const byId = new Map<string, number>()
    trace.events.forEach((event, index) => byId.set(event.id, index))
    const stamps = loaded.canonical ? new Map<string, FileStamp>() : await stampFiles(trace, this.fs)
    // A compressed file's source pointer carries `codec`; the reader decompresses the whole file for one
    // record, so a batch of reads shares one reload instead of one decompression per event.
    const compressed = !loaded.canonical && trace.events.some(event => event.source.codec !== undefined)
    return {
      session,
      trace,
      canonical: loaded.canonical,
      compressed,
      byId,
      stamps,
      prints,
      pinned: 0,
      evicted: new AbortController(),
    }
  }
}
