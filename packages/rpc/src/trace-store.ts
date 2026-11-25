import type { ReconstructResult, Trace, TraceEvent } from '@rivus/estela-schema'
import type { FileStamp } from './source-check.ts'
import type {
  EventDetail,
  EventRead,
  LoadedTrace,
  LoadHandle,
  LoadOpts,
  LoadProgress,
  ResolvedSession,
  TraceRedaction,
  TraceStoreDeps,
  TraceViewResult,
} from './trace-store-types.ts'
import { fitView, fold, reconstruct, summaryOf, VIEW_BUDGET_BYTES } from '@rivus/estela-kernel'
import { TraceCache, type TraceEntry } from './trace-cache.ts'
import { checkedOriginal, stampMatches } from './source-check.ts'
import { TraceIdMaps, type TraceIds } from './trace-ids.ts'
import { canonicalRecord, compressedRecord, reloadOnce, reloadShared } from './original-reload.ts'

export type {
  EventDetail,
  FileStamp,
  LoadedTrace,
  LoadHandle,
  LoadOpts,
  LoadProgress,
  ResolvedSession,
  TraceRedaction,
  TraceStoreDeps,
  TraceViewResult,
}

export const CURRENT_TRACE_ID = 'current' // Trace id of the launch session.
const VIEW_BYTES = VIEW_BUDGET_BYTES - 64 * 1024 // Reserve 64 KB of the 12 MB budget for `summary` and envelope.
const READ_BATCH = 32 // Concurrent source-pointer reads in `withEvents`.
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
  promise: Promise<TraceEntry>
}

export class LoadCancelledError extends Error {
  constructor(traceId: string) {
    super(`load of ${traceId} was cancelled`)
    this.name = 'LoadCancelledError'
  }
}

export class SnapshotChangedError extends Error {
  constructor(traceId: string) {
    super(`snapshot of ${traceId} changed`)
    this.name = 'SnapshotChangedError'
  }
}

/**
 * Server side of `get-trace-view`, `get-event`, and `reconstruct`: resolves
 * trace ids, shares in-flight loads, keeps the last 3 traces without originals, and
 * reads originals back from source pointers on demand. With a redaction, every event and lane id it sends that
 * redaction would change is an alias (`TraceIds`), and `get-event` and `reconstruct` take that alias back.
 */
export class TraceStore {
  private readonly deps: TraceStoreDeps
  /** The last traces loaded, without originals. */
  private readonly cache: TraceCache
  /** The aliases of each loaded trace: the store's own, and those of any redaction a caller names. */
  private readonly ids = new TraceIdMaps()
  /** Each trace a caller kept whole, by event id, for `presented`. */
  private readonly indexOf = new WeakMap<Trace, Map<string, TraceEvent>>()
  private readonly pending = new Map<string, Pending>()
  private readonly owners = new WeakMap<object, { key: string; handle: LoadHandle }>()
  /** Latest `open` per owner, counted before any await, so a slower earlier open cannot win. */
  private readonly generations = new WeakMap<object, number>()

  constructor(deps: TraceStoreDeps) {
    this.deps = deps
    this.cache = new TraceCache(deps.fs)
  }

  /** Keys of cached traces, least recently used first. */
  cachedKeys(): string[] {
    return this.cache.cachedKeys()
  }

  /** Put an already loaded trace in the cache (the shell loads the launch session before listening). */
  async seed(session: ResolvedSession, loaded: LoadedTrace): Promise<void> {
    this.cache.add(await this.cache.of(session, loaded))
  }

  /**
   * Start or join the load of `traceId`. With an `owner` (one browser connection),
   * a new `open` supersedes that owner's previous one: its hold is released,
   * which aborts the old load when nobody else holds it.
   */
  async open(traceId: string, owner?: object): Promise<LoadHandle> {
    const generation = owner ? (this.generations.get(owner) ?? 0) + 1 : 0
    if (owner) {
      this.generations.set(owner, generation)
    }
    const current = (): boolean => !owner || this.generations.get(owner) === generation
    return this.guard(async () => {
      const session = await this.resolveOrThrow(traceId)
      const handle = await this.hold(traceId, session, current)
      if (owner) {
        if (!current()) {
          // A later `open` from this connection started while this one waited.
          handle.release()
          throw new LoadCancelledError(traceId)
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
  async view(traceId: string, owner?: object): Promise<TraceViewResult> {
    return this.guard(async () => {
      const entry = await this.entryFor(traceId, owner)
      if (!entry.view) {
        // Ids are shown before the text is redacted, since a shown id must come from the recorded one.
        const ids = this.ids.of(entry.trace, this.deps.redact)
        entry.view = fitView(this.show(ids?.shown(entry.trace) ?? entry.trace), {
          maxString: this.deps.maxString,
          maxBytes: VIEW_BYTES,
        })
        if (entry.view.trace.view?.withinBudget === false) {
          this.deps.log?.(
            `view of ${traceId} is ${entry.view.bytes} bytes at the 256-character floor, over the ${VIEW_BYTES}-byte budget`,
          )
        }
      }
      return { traceId, trace: entry.view.trace, summary: summaryOf(fold(entry.trace)), bytes: entry.view.bytes }
    })
  }

  /**
   * The full event `id` names (an id as recorded, or an alias), with `original` read back from its source
   * pointer (or `originalUnavailable`). Ids are resolved here once and shown here once, by the aliases of
   * `read.redact` when the caller names one and else of the store's own redaction.
   */
  async event(traceId: string, id: string, read: EventRead = {}): Promise<EventDetail> {
    return this.guard(async () => {
      const entry = await this.entryFor(traceId, read.owner)
      const ids = this.ids.of(entry.trace, read.redact ?? this.deps.redact)
      return this.shown(await this.detail(traceId, entry, id, ids), ids)
    })
  }

  /**
   * `run` reads several events in full, in the order asked (the report's first events). Source
   * pointers are read a few at a time, so a long read never runs out of file handles. A canonical
   * file is reloaded once for all of `run`'s reads, and a compressed log is decompressed once for
   * them; both are dropped when `run` ends. Ids are asked for as the view shows them, and each event
   * comes back as `get-event` shows it. A report, which redacts whatever the server does, gives the ids
   * that are still recorded its own aliases. Errors leave redacted like every other read.
   */
  async withEvents<T>(
    traceId: string,
    run: (read: (ids: readonly string[]) => Promise<EventDetail[]>) => Promise<T>,
    owner?: object,
  ): Promise<T> {
    const entry = await this.guard(() => this.entryFor(traceId, owner))
    entry.pinned += 1
    try {
      // Started on the first compressed read, not before `run`: one decompression serves every batch,
      // and a failed reload falls back to per-event reads instead of failing the whole report.
      const reload = reloadOnce(() => this.guard(() => reloadShared(entry, () => this.loadAgain(entry))))
      const read = async (ids: readonly string[]): Promise<EventDetail[]> => {
        if (entry.canonical) {
          return Promise.all(ids.map(id => this.presentedEvent(traceId, entry, id)))
        }
        const trace = entry.compressed ? await reload() : undefined
        const out: EventDetail[] = []
        for (let start = 0; start < ids.length; start += READ_BATCH) {
          out.push(
            ...(await Promise.all(
              ids
                .slice(start, start + READ_BATCH)
                .map(id =>
                  trace === undefined
                    ? this.presentedEvent(traceId, entry, id)
                    : this.guard(async () => this.compressedEvent(entry, trace, id, traceId)),
                ),
            )),
          )
        }
        return out
      }
      return await run(read)
    } finally {
      entry.pinned -= 1
      if (entry.pinned === 0) {
        entry.reload = undefined
      }
    }
  }

  /** Ids in and out like `get-event`: they come from the log and may carry the paths and tokens it holds. */
  async reconstruct(traceId: string, eventId: string, owner?: object): Promise<ReconstructResult> {
    return this.guard(async () => {
      const entry = await this.entryFor(traceId, owner)
      const ids = this.ids.of(entry.trace, this.deps.redact)
      const surface = reconstruct(entry.trace, ids?.findEvent(eventId) ?? eventId)
      return this.show(ids?.surface(surface) ?? surface)
    })
  }

  /**
   * `get-event`'s results for `shown`, ids as the view shows them, with the events and their originals from
   * `loaded`: a trace the caller loaded and kept whole, as `build` does, so no file is read again. Nothing
   * checks that the source still holds the record, as `get-event` does.
   */
  presented(loaded: Trace, shown: readonly string[]): EventDetail[] {
    const ids = this.ids.of(loaded, this.deps.redact)
    let byId = this.indexOf.get(loaded)
    if (!byId) {
      byId = new Map(loaded.events.map(event => [event.id, event]))
      this.indexOf.set(loaded, byId)
    }
    return shown.map(id => {
      const event = byId.get(ids?.findEvent(id) ?? id)
      if (!event) {
        throw new Error(this.show(`no event ${id}`))
      }
      return this.shown(event, ids)
    })
  }

  /**
   * Runs `read` over the loaded trace of `traceId` (originals dropped), through its own hold like an MCP read.
   * What `read` returns is not shown: the caller shows it. Errors leave redacted like every other read.
   */
  async withTrace<T>(traceId: string, read: (trace: Trace) => T): Promise<T> {
    return this.guard(async () => read((await this.entryFor(traceId)).trace))
  }

  /** An event of a cache entry, as `get-event` shows it. */
  private async presentedEvent(traceId: string, entry: TraceEntry, id: string): Promise<EventDetail> {
    const ids = this.ids.of(entry.trace, this.deps.redact)
    return this.guard(async () => this.shown(await this.detail(traceId, entry, id, ids), ids))
  }

  private shown(detail: EventDetail, ids: TraceIds | undefined): EventDetail {
    return this.show(ids?.eventShown(detail) ?? detail)
  }

  private show<T>(value: T): T {
    return this.deps.redact ? this.deps.redact.value(value) : value
  }

  /** Error messages carry paths and file content; they leave the store redacted. */
  private scrub(error: unknown): Error {
    if (error instanceof LoadCancelledError || error instanceof SnapshotChangedError) {
      return error
    }
    const out = new Error(this.show(error instanceof Error ? error.message : String(error)))
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

  private async resolveOrThrow(traceId: string): Promise<ResolvedSession> {
    const session = await this.deps.resolve(traceId)
    if (!session) {
      throw new Error(`unknown trace id: ${traceId}`)
    }
    return session
  }

  /**
   * Through a hold, so another connection's supersede cannot cancel this read:
   * the owner's own open hold for this session, else a hold of its own.
   */
  private async entryFor(traceId: string, owner?: object): Promise<TraceEntry> {
    const session = await this.resolveOrThrow(traceId)
    const cached = this.cache.get(session.key)
    if (cached) {
      return cached
    }
    const owned = owner ? this.owners.get(owner) : undefined
    if (owned?.key === session.key) {
      await owned.handle.done
    } else {
      const handle = await this.hold(traceId, session)
      try {
        await handle.done
      } finally {
        handle.release()
      }
    }
    const entry = this.cache.get(session.key)
    if (!entry) {
      throw new Error(`${traceId} was evicted before it could be read`)
    }
    return entry
  }

  private async totalBytes(session: ResolvedSession): Promise<number> {
    const info = await this.deps.fs.stat(session.target.path, { followSymlinks: true })
    return info?.size ?? 0
  }

  private cachedHandle(total: number): LoadHandle {
    const progress = { bytesRead: total, totalBytes: total }
    return {
      cached: true,
      progress: () => progress,
      onProgress: () => () => {},
      done: Promise.resolve(),
      release: () => {},
    }
  }

  private activePending(key: string): Pending | undefined {
    const pending = this.pending.get(key)
    return pending && !pending.state.controller.signal.aborted ? pending : undefined
  }

  /** `current` is checked before a new load starts, so a superseded `open` never starts one. */
  private async hold(
    traceId: string,
    session: ResolvedSession,
    current: () => boolean = () => true,
  ): Promise<LoadHandle> {
    if (this.cache.get(session.key)) {
      return this.cachedHandle(await this.totalBytes(session))
    }
    let pending = this.activePending(session.key)
    if (!pending) {
      const total = await this.totalBytes(session)
      if (this.cache.get(session.key)) {
        return this.cachedHandle(total)
      }
      pending = this.activePending(session.key)
      if (!pending) {
        if (!current()) {
          throw new LoadCancelledError(traceId)
        }
        pending = this.start(traceId, session, total)
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
          state.controller.abort(new LoadCancelledError(traceId))
        }
      },
    }
  }

  private start(traceId: string, session: ResolvedSession, totalBytes: number): Pending {
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
        const entry = await this.cache.of(session, loaded)
        state.controller.signal.throwIfAborted()
        if (session.expect && !(await stampMatches(this.deps.fs, session.target.path, session.expect))) {
          throw new SnapshotChangedError(traceId)
        }
        state.controller.signal.throwIfAborted()
        this.cache.add(entry)
        onProgress(totalBytes)
        return entry
      } catch (error) {
        if (state.controller.signal.aborted) {
          throw new LoadCancelledError(traceId)
        }
        if (
          !(error instanceof SnapshotChangedError)
          && session.expect
          && !(await stampMatches(this.deps.fs, session.target.path, session.expect))
        ) {
          throw new SnapshotChangedError(traceId)
        }
        throw this.scrub(error)
      } finally {
        state.settled = true
        state.listeners.clear()
        if (this.pending.get(session.key)?.state === state) {
          this.pending.delete(session.key)
        }
      }
    })()
    promise.catch(() => {})
    const pending = { state, promise }
    if (!state.settled) {
      this.pending.set(session.key, pending)
    }
    return pending
  }

  /** Load a canonical or compressed file again for its originals; the entry's pin keeps it while a batch runs. */
  private loadAgain(entry: TraceEntry): Promise<LoadedTrace> {
    return this.deps.load(entry.session, { signal: entry.evicted.signal, onProgress: () => {} })
  }

  /** Shown like `get-event`: the cached event still carries the recorded ids. */
  private compressedEvent(entry: TraceEntry, trace: Trace, id: string, traceId: string): EventDetail {
    const ids = this.ids.of(entry.trace, this.deps.redact)
    const found = compressedRecord(entry.trace, trace, entry.byId, entry.prints, ids?.findEvent(id) ?? id, traceId)
    const detail =
      'unavailable' in found
        ? { ...found.event, originalUnavailable: found.unavailable }
        : { ...found.event, original: found.original }
    return this.shown(detail, ids)
  }

  /**
   * The event `shown` names, as the view shows it, read whole from its source pointer (or with
   * `originalUnavailable`); not shown. `ids` resolve `shown` once: what they give is a recorded id, looked up
   * as itself. Left out, the ids are looked up as recorded.
   */
  private async detail(traceId: string, entry: TraceEntry, shown: string, ids?: TraceIds): Promise<EventDetail> {
    const index = entry.byId.get(ids?.findEvent(shown) ?? shown)
    if (index === undefined) {
      throw new Error(`no event ${shown} in ${traceId}`)
    }
    const event = entry.trace.events[index]!
    if (entry.canonical) {
      const reloaded = await reloadShared(entry, () => this.loadAgain(entry))
      return { ...event, original: canonicalRecord(reloaded, entry.trace, index) }
    }
    const checked = await checkedOriginal(
      this.deps.fs,
      this.deps.readOriginal,
      event,
      entry.stamps.get(event.source.file),
      entry.prints[index]!,
    )
    return 'unavailable' in checked
      ? { ...event, originalUnavailable: checked.unavailable }
      : { ...event, original: checked.original }
  }
}
