import type { ReconstructResult, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { FittedView, SessionFs, SessionRef, SessionSummary } from '@rivus/agent-trace-kernel'
import type { FileStamp } from './source-check.ts'
import { fitView, fold, reconstruct, splitSessionRef, summaryOf, VIEW_BUDGET_BYTES } from '@rivus/agent-trace-kernel'
import { checkedOriginal, fingerprints, stampFiles } from './source-check.ts'

/** Loaded traces kept in memory, without originals (plan 3.5). */
const CAPACITY = 3
/** The 12 MB budget covers the whole response; keep 64 KB for `summary` and the envelope. */
const VIEW_BYTES = VIEW_BUDGET_BYTES - 64 * 1024
/** Concurrent source-pointer reads in `withEvents`. */
const READ_BATCH = 32

/** What a `ref` resolves to. The shell's resolver (its session catalog) supplies it. */
export interface ResolvedSession {
  /** Cache key: one per session (the catalog ref, or the launch path outside the dev server). */
  key: string
  /** What the host loads: `file` or `file#sessionId`, or a discovered `SessionRef`. */
  path: string | SessionRef
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

export interface TraceStoreDeps {
  resolve: (ref: string) => ResolvedSession | undefined | Promise<ResolvedSession | undefined>
  load: (session: ResolvedSession, opts: LoadOpts) => Promise<LoadedTrace>
  /** Reads for the source-pointer originals: stamps, `checkedOriginal`, and `totalBytes`. */
  fs: SessionFs
  /** Applied to everything sent out: view trace, events, and error messages. Redaction lives here. */
  present?: <T>(value: T) => T
  /** Server log, for conditions the operator should see (a view over budget). */
  log?: (message: string) => void
  /** Default 4,096 characters. */
  maxString?: number
}

export interface LoadProgress {
  bytesRead: number
  totalBytes: number
}

export interface TraceViewResult {
  ref: string
  /** View trace (`toView`); `trace.view` holds the cap used and whether the view fits the budget. */
  trace: Trace
  summary: SessionSummary
  /** Serialized size of `trace` in bytes. */
  bytes: number
}

/** `get-event` result: the full event, or the reason its original cannot be read back. */
export type EventDetail = TraceEvent & { originalUnavailable?: string }

interface Entry {
  session: ResolvedSession
  trace: Trace
  canonical: boolean
  byId: Map<string, number>
  stamps: Map<string, FileStamp>
  prints: Uint32Array
  view?: FittedView
  /** Canonical files only: the reload in flight, shared by concurrent `event` calls and dropped when it settles (or when the last `withEvents` ends). */
  reload?: Promise<Trace>
  /** Running `withEvents` calls: while above 0, a settled reload is kept. */
  pinned: number
  /** Aborts the canonical reload when the entry is evicted. */
  evicted: AbortController
}

/** What a hold needs. It does not reach the loaded trace, so an evicted trace can be collected. */
interface HoldState {
  controller: AbortController
  holders: number
  settled: boolean
  progress: LoadProgress
  listeners: Set<(progress: LoadProgress) => void>
}

interface Pending {
  state: HoldState
  promise: Promise<Entry>
}

/** One holder's claim on a load. Releasing the last hold of an unfinished load aborts it. */
export interface LoadHandle {
  cached: boolean
  progress: () => LoadProgress
  onProgress: (listener: (progress: LoadProgress) => void) => () => void
  done: Promise<void>
  release: () => void
}

export class LoadCancelledError extends Error {
  constructor(ref: string) {
    super(`load of ${ref} was cancelled`)
    this.name = 'LoadCancelledError'
  }
}

function withoutOriginals(trace: Trace): Trace {
  return {
    ...trace,
    events: trace.events.map(event => {
      if (!('original' in event)) {
        return event
      }
      const { original: _original, ...rest } = event
      return rest
    }),
  }
}

/**
 * Server side of `get-trace-view`, `get-event`, and `reconstruct`: resolves
 * refs, shares in-flight loads, keeps the last 3 traces without originals, and
 * reads originals back from source pointers on demand.
 */
export class TraceStore {
  private readonly deps: TraceStoreDeps
  private readonly entries = new Map<string, Entry>()
  private readonly pending = new Map<string, Pending>()
  private readonly owners = new WeakMap<object, { key: string; handle: LoadHandle }>()
  /** Latest `open` per owner, counted before any await, so a slower earlier open cannot win. */
  private readonly generations = new WeakMap<object, number>()

  constructor(deps: TraceStoreDeps) {
    this.deps = deps
  }

  /** Keys of cached traces, least recently used first. */
  cachedKeys(): string[] {
    return [...this.entries.keys()]
  }

  /** Put an already loaded trace in the cache (the shell loads the launch session before listening). */
  async seed(session: ResolvedSession, loaded: LoadedTrace): Promise<void> {
    this.remember(await this.entryOf(session, loaded))
  }

  /**
   * Start or join the load of `ref`. With an `owner` (one browser connection),
   * a new `open` supersedes that owner's previous one: its hold is released,
   * which aborts the old load when nobody else holds it.
   */
  async open(ref: string, owner?: object): Promise<LoadHandle> {
    const generation = owner ? (this.generations.get(owner) ?? 0) + 1 : 0
    if (owner) {
      this.generations.set(owner, generation)
    }
    const current = (): boolean => !owner || this.generations.get(owner) === generation
    return this.guard(async () => {
      const session = await this.resolveOrThrow(ref)
      const handle = await this.hold(ref, session, current)
      if (owner) {
        if (!current()) {
          // A later `open` from this connection started while this one waited.
          handle.release()
          throw new LoadCancelledError(ref)
        }
        this.owners.get(owner)?.handle.release()
        this.owners.set(owner, { key: session.key, handle })
        const forget = (): void => {
          if (this.owners.get(owner)?.handle === handle) {
            this.owners.delete(owner)
          }
        }
        handle.done.then(forget, forget)
      }
      return handle
    })
  }

  /**
   * `owner` is the calling connection. Its reads ride on its own `open` of the
   * same session, so its supersede or cancel also ends them. Any other caller
   * (another tab, MCP) takes its own hold.
   */
  async view(ref: string, owner?: object): Promise<TraceViewResult> {
    return this.guard(async () => {
      const entry = await this.entryFor(ref, owner)
      if (!entry.view) {
        entry.view = fitView(this.present(entry.trace), { maxString: this.deps.maxString, maxBytes: VIEW_BYTES })
        if (entry.view.trace.view?.withinBudget === false) {
          this.deps.log?.(
            `view of ${ref} is ${entry.view.bytes} bytes at the 256-character floor, over the ${VIEW_BYTES}-byte budget`,
          )
        }
      }
      return { ref, trace: entry.view.trace, summary: summaryOf(fold(entry.trace)), bytes: entry.view.bytes }
    })
  }

  /** The full event, with `original` read back from its source pointer (or `originalUnavailable`). */
  async event(ref: string, id: string, owner?: object): Promise<EventDetail> {
    return this.guard(async () => {
      const entry = await this.entryFor(ref, owner)
      const index = entry.byId.get(id)
      if (index === undefined) {
        throw new Error(`no event ${id} in ${ref}`)
      }
      const event = entry.trace.events[index]!
      if (entry.canonical) {
        return this.present({ ...event, original: await this.canonicalOriginal(entry, index) })
      }
      const checked = await checkedOriginal(
        this.deps.fs,
        event,
        entry.stamps.get(event.source.file),
        entry.prints[index]!,
      )
      if ('unavailable' in checked) {
        return this.present({ ...event, originalUnavailable: checked.unavailable })
      }
      return this.present({ ...event, original: checked.original })
    })
  }

  /**
   * `run` reads several events in full, in the order asked (the report's first events). Source
   * pointers are read a few at a time, so a long read never runs out of file handles. A canonical
   * file is reloaded once for all of `run`'s reads and dropped when `run` ends.
   */
  async withEvents<T>(
    ref: string,
    run: (read: (ids: readonly string[]) => Promise<EventDetail[]>) => Promise<T>,
    owner?: object,
  ): Promise<T> {
    const entry = await this.guard(() => this.entryFor(ref, owner))
    entry.pinned += 1
    const read = async (ids: readonly string[]): Promise<EventDetail[]> => {
      if (entry.canonical) {
        return Promise.all(ids.map(id => this.event(ref, id, owner)))
      }
      const out: EventDetail[] = []
      for (let start = 0; start < ids.length; start += READ_BATCH) {
        out.push(...(await Promise.all(ids.slice(start, start + READ_BATCH).map(id => this.event(ref, id, owner)))))
      }
      return out
    }
    try {
      return await run(read)
    } finally {
      entry.pinned -= 1
      if (entry.pinned === 0) {
        entry.reload = undefined
      }
    }
  }

  async reconstruct(ref: string, eventId: string, owner?: object): Promise<ReconstructResult> {
    return this.guard(async () => reconstruct((await this.entryFor(ref, owner)).trace, eventId))
  }

  private present<T>(value: T): T {
    return this.deps.present ? this.deps.present(value) : value
  }

  /** Error messages carry paths and file content; they leave the store redacted. */
  private scrub(error: unknown): Error {
    if (error instanceof LoadCancelledError) {
      return error
    }
    const out = new Error(this.present(error instanceof Error ? error.message : String(error)))
    if (error instanceof Error) {
      out.name = error.name
    }
    return out
  }

  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      throw this.scrub(error)
    }
  }

  private async resolveOrThrow(ref: string): Promise<ResolvedSession> {
    const session = await this.deps.resolve(ref)
    if (!session) {
      throw new Error(`unknown session ref: ${ref}`)
    }
    return session
  }

  /**
   * Through a hold, so another connection's supersede cannot cancel this read:
   * the owner's own open hold for this session, else a hold of its own.
   */
  private async entryFor(ref: string, owner?: object): Promise<Entry> {
    const session = await this.resolveOrThrow(ref)
    const cached = this.touch(session.key)
    if (cached) {
      return cached
    }
    const owned = owner ? this.owners.get(owner) : undefined
    if (owned?.key === session.key) {
      await owned.handle.done
    } else {
      const handle = await this.hold(ref, session)
      try {
        await handle.done
      } finally {
        handle.release()
      }
    }
    const entry = this.touch(session.key)
    if (!entry) {
      throw new Error(`${ref} was evicted before it could be read`)
    }
    return entry
  }

  private async entryOf(session: ResolvedSession, loaded: LoadedTrace): Promise<Entry> {
    const prints = fingerprints(loaded.trace)
    const trace = withoutOriginals(loaded.trace)
    const byId = new Map<string, number>()
    trace.events.forEach((event, index) => byId.set(event.id, index))
    const stamps = loaded.canonical ? new Map<string, FileStamp>() : await stampFiles(trace, this.deps.fs)
    return {
      session,
      trace,
      canonical: loaded.canonical,
      byId,
      stamps,
      prints,
      pinned: 0,
      evicted: new AbortController(),
    }
  }

  private touch(key: string): Entry | undefined {
    const entry = this.entries.get(key)
    if (entry) {
      this.entries.delete(key)
      this.entries.set(key, entry)
    }
    return entry
  }

  private remember(entry: Entry): void {
    this.entries.get(entry.session.key)?.evicted.abort()
    this.entries.delete(entry.session.key)
    this.entries.set(entry.session.key, entry)
    while (this.entries.size > CAPACITY) {
      const [key, oldest] = this.entries.entries().next().value!
      oldest.evicted.abort()
      this.entries.delete(key)
    }
  }

  private async totalBytes(session: ResolvedSession): Promise<number> {
    const file = typeof session.path === 'string' ? splitSessionRef(session.path).file : session.path.path
    const info = await this.deps.fs.stat(file, { followSymlinks: true })
    return info?.size ?? 0
  }

  /** `current` is checked before a new load starts, so a superseded `open` never starts one. */
  private async hold(ref: string, session: ResolvedSession, current: () => boolean = () => true): Promise<LoadHandle> {
    if (this.touch(session.key)) {
      const total = await this.totalBytes(session)
      const progress = { bytesRead: total, totalBytes: total }
      return {
        cached: true,
        progress: () => progress,
        onProgress: () => () => {},
        done: Promise.resolve(),
        release: () => {},
      }
    }
    let pending = this.pending.get(session.key)
    if (!pending) {
      const total = await this.totalBytes(session)
      pending = this.pending.get(session.key)
      if (!pending) {
        if (!current()) {
          throw new LoadCancelledError(ref)
        }
        pending = this.start(ref, session, total)
      }
    }
    const state = pending.state
    state.holders += 1
    let released = false
    const done = pending.promise.then(() => undefined)
    // Marked handled: a released holder may never await it.
    done.catch(() => {})
    return {
      cached: false,
      progress: () => state.progress,
      onProgress: listener => {
        if (state.settled) {
          return () => {}
        }
        state.listeners.add(listener)
        return () => state.listeners.delete(listener)
      },
      done,
      release: () => {
        if (released) {
          return
        }
        released = true
        state.holders -= 1
        if (state.holders <= 0 && !state.settled) {
          state.controller.abort(new LoadCancelledError(ref))
        }
      },
    }
  }

  private start(ref: string, session: ResolvedSession, totalBytes: number): Pending {
    const state: HoldState = {
      controller: new AbortController(),
      holders: 0,
      settled: false,
      progress: { bytesRead: 0, totalBytes },
      listeners: new Set(),
    }
    const onProgress = (bytes: number): void => {
      state.progress = { bytesRead: totalBytes > 0 ? Math.min(bytes, totalBytes) : bytes, totalBytes }
      for (const listener of state.listeners) {
        listener(state.progress)
      }
    }
    const promise = (async () => {
      try {
        const loaded = await this.deps.load(session, { signal: state.controller.signal, onProgress })
        state.controller.signal.throwIfAborted()
        const entry = await this.entryOf(session, loaded)
        this.remember(entry)
        onProgress(totalBytes)
        return entry
      } catch (error) {
        throw state.controller.signal.aborted ? new LoadCancelledError(ref) : this.scrub(error)
      } finally {
        state.settled = true
        state.listeners.clear()
        this.pending.delete(session.key)
      }
    })()
    promise.catch(() => {})
    const pending = { state, promise }
    this.pending.set(session.key, pending)
    return pending
  }

  /**
   * A canonical file keeps originals inside it: reload it, keep only the one
   * requested. Concurrent calls share the reload in flight; nothing is kept
   * after it settles. Aborted if the entry is evicted first.
   */
  private async canonicalOriginal(entry: Entry, index: number): Promise<unknown> {
    if (!entry.reload) {
      const reload = this.deps
        .load(entry.session, { signal: entry.evicted.signal, onProgress: () => {} })
        .then(loaded => loaded.trace)
      entry.reload = reload
      const clear = (): void => {
        if (entry.reload === reload && entry.pinned === 0) {
          entry.reload = undefined
        }
      }
      reload.then(clear, clear)
    }
    const trace = await entry.reload
    const id = entry.trace.events[index]!.id
    return (trace.events[index]?.id === id ? trace.events[index] : trace.events.find(event => event.id === id))
      ?.original
  }
}
