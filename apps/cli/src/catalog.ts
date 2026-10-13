import type { SessionRef } from '@rivus/agent-trace-kernel'
import type { IndexSummary, SessionIndex } from '@rivus/agent-trace-runtime-node'
import type { HostListEntry, ListSessionsQuery, ListSessionsResult, ResolvedSession } from '@rivus/agent-trace-rpc'
import type { Trace } from '@rivus/agent-trace-schema'
import { redactText } from '@rivus/agent-kit/redact'
import {
  builtinSessionAdapters,
  sessionAdapterHome,
  type SessionAdapter,
  type SessionAdapters,
} from '@rivus/agent-kit/sessions'
import { SESSION_SUMMARY_VERSION } from '@rivus/agent-kit/transcript'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { splitSessionRef } from '@rivus/agent-trace-kernel'
import { emitSessions } from '@rivus/agent-trace-rpc'
import { openSessionIndex } from '@rivus/agent-trace-runtime-node'
import { discoverRows, hostState, progressOf, type HostProgress, type HostState } from './catalog-discover.ts'
import {
  activityLabel,
  indexHeadOf,
  publicRow,
  rowFromIndex,
  sameRow,
  summarizeRow,
  type CatalogPlatform,
  type LiveRow,
  type Redactor,
} from './catalog-rows.ts'
import { errorMessage, parseReadFailure } from './read-failure.ts'
import { oneLine, sessionRefId } from './session-ref.ts'
import { SummaryQueue } from './summary-queue.ts'

export type { HostProgress } from './catalog-discover.ts'

const CONCURRENCY = 4
/** A file at least this large is summarized alone (a 355 MB Codex log loads to about 3 GB). */
const HEAVY_BYTES = 64 * 1024 * 1024
/** Finished summaries are written to the index and announced to browsers at most this often. */
const FLUSH_MS = 150
/**
 * The session index compares summary versions for equality, and the host implementations wrote
 * version 1 with different numbers (design note §3: usage merge and decode among them), so a
 * host-era cache entry must not be served. This offset moves past every version the hosts
 * wrote and must stay; later bumps track the kit's SESSION_SUMMARY_VERSION.
 */
const HOST_ERA_OFFSET = 1
const INDEX_SUMMARY_VERSION = SESSION_SUMMARY_VERSION + HOST_ERA_OFFSET

export interface CatalogOptions {
  adapters?: SessionAdapters
  platform?: CatalogPlatform
  index?: SessionIndex
  noIndex?: boolean
  /** Queue summaries without running them until `resumeSummaries()`: the server starts first. */
  deferSummaries?: boolean
}

/**
 * The shell's session catalog (plan 3.4): rows from the index and the latest `discover` pass,
 * summaries computed newest (or visible) first at 4 at a time, and ref → file resolution for
 * the TraceStore, which loads and holds the traces.
 */
export class SessionCatalog {
  private readonly adapters: SessionAdapters
  private readonly hosts: readonly SessionAdapter[]
  private readonly platform: CatalogPlatform
  private readonly index: SessionIndex
  private readonly redact: Redactor
  private readonly hostStates: HostState[]
  private rows = new Map<string, LiveRow>()
  /** Refs the server resolves: discovered rows and paths opened from the command line. */
  private readonly targets = new Map<string, SessionRef | string>()
  /** Rows that disappeared in a re-read, by the revision they were removed at. */
  private readonly removed = new Map<string, number>()
  private readonly queue: SummaryQueue<LiveRow>
  private readonly finished: IndexSummary[] = []
  private started: Promise<void> | undefined
  private discovery: Promise<void> | undefined
  private cachedStart = false
  private revision = 0
  private flushTimer: ReturnType<typeof setTimeout> | undefined

  constructor(options: CatalogOptions = {}) {
    this.adapters = options.adapters ?? builtinSessionAdapters
    this.hosts = Object.values(this.adapters).filter(adapter => adapter !== undefined)
    this.platform = options.platform ?? createNodePlatform()
    const home = this.platform.home
    // Titles and prompts are session text: redacted like the workspace unless AGENT_TRACE_REDACT=0.
    this.redact = this.platform.env.AGENT_TRACE_REDACT === '0' ? text => text : text => redactText(text, { home })
    this.index =
      options.index
      ?? openSessionIndex({
        enabled: options.noIndex !== true,
        homeDir: this.platform.home,
        env: this.platform.env,
        summaryVersion: INDEX_SUMMARY_VERSION,
      })
    this.hostStates = this.hosts.map(hostState)
    this.queue = new SummaryQueue<LiveRow>(
      {
        concurrency: CONCURRENCY,
        key: row => row.ref,
        rank: row => row.lastActiveAt,
        heavy: row => row.size >= HEAVY_BYTES,
        run: row => this.summarize(row),
      },
      options.deferSummaries === true,
    )
  }

  resumeSummaries(): void {
    this.queue.resume()
  }

  /**
   * Rows are ready when this resolves. With an index from an earlier launch that is at once
   * (its rows and cached numbers), and the `discover` pass runs behind it; otherwise it waits
   * for `discover`. `onProgress` reports that pass per host.
   */
  start(onProgress?: (hosts: readonly HostProgress[]) => void): Promise<void> {
    this.started ??= this.begin(onProgress)
    return this.started
  }

  /** Why the index could not be opened; the catalog then runs as with `--no-index`. */
  get indexUnavailable(): string | undefined {
    // The reason names the cache path: always `~`, whatever AGENT_TRACE_REDACT says.
    return this.index.unavailable ? redactText(this.index.unavailable, { home: this.platform.home }) : undefined
  }

  /** `true` when `start` served rows from the index while `discover` runs. */
  get startedFromIndex(): boolean {
    return this.cachedStart
  }

  /** Resolves when this launch's `discover` pass is done. */
  async discovered(): Promise<void> {
    await this.start()
    await this.discovery
  }

  /** Resolves when discovery is done, no summary is queued or running, and the last batch is written. */
  async whenIdle(): Promise<void> {
    await this.discovered()
    await this.queue.whenIdle()
    this.flush()
  }

  /**
   * Register a path given on the command line, already loaded as `trace` (the shell loads it
   * before the server listens). Returns its ref, which is the file's list row ref when it has one.
   */
  openPath(input: string, trace: Trace): string {
    const { file, sessionId } = splitSessionRef(input)
    // Same ref as the file's list row: the session id counts only in the `path#id` form.
    const ref = sessionRefId({ host: trace.host.id || 'agent-trace', path: file, ...(sessionId ? { sessionId } : {}) })
    this.targets.set(ref, input)
    return ref
  }

  /** The TraceStore's resolver: every list row and every opened path. The ref is the cache key. */
  resolve(ref: string): ResolvedSession | undefined {
    const target = this.targets.get(ref)
    return target === undefined ? undefined : { key: ref, path: target }
  }

  pickChoices(): { value: string; label: string }[] {
    const names = new Map(this.hosts.map(host => [host.agent, host.displayName]))
    return this.sortedRows()
      .filter(row => !row.error)
      .map(row => ({
        value: row.ref,
        label: [
          row.title ? this.redact(row.title) : 'Untitled',
          names.get(row.target.host) ?? row.target.host,
          row.project ? this.redact(row.project) : '',
          activityLabel(row.lastActiveAt),
        ]
          .map(oneLine)
          .filter(part => part.length > 0)
          .join(' · '),
      }))
  }

  async listSessions(input: ListSessionsQuery = {}): Promise<ListSessionsResult> {
    await this.start()
    if (input.first && input.first.length > 0) {
      this.queue.prioritize(input.first)
    }
    const since = input.since
    const rows = this.sortedRows()
      .filter(row => since === undefined || row.revision > since)
      .map(row => publicRow(row, this.redact))
    const removed = since === undefined ? [] : [...this.removed].filter(([, at]) => at > since).map(([ref]) => ref)
    const query = input.query?.trim() ?? ''
    return {
      hosts: this.hostEntries(),
      rows,
      complete: since === undefined,
      ...(removed.length > 0 ? { removed } : {}),
      ...(query ? { matches: this.search(query) } : {}),
      pending: this.pendingCount(),
      revision: this.revision,
    }
  }

  close(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
    }
    this.flush()
    this.index.close()
  }

  private async begin(onProgress?: (hosts: readonly HostProgress[]) => void): Promise<void> {
    const stored = this.readIndex(() => this.index.rows(), [])
    const run = () => this.discover(onProgress)
    if (stored.length === 0) {
      this.discovery = run()
      await this.discovery
      return
    }
    for (const entry of stored) {
      const row = rowFromIndex(entry, this.platform.home)
      row.revision = this.bump()
      this.rows.set(row.ref, row)
      this.targets.set(row.ref, row.target)
    }
    this.cachedStart = true
    this.announce()
    this.discovery = run()
    this.discovery.catch(() => {})
  }

  private async discover(onProgress?: (hosts: readonly HostProgress[]) => void): Promise<void> {
    const fresh = await discoverRows(this.hostStates, this.platform, () =>
      onProgress?.(progressOf(this.hostStates, this.platform.home)),
    )
    const gone: string[] = []
    for (const [ref, old] of this.rows) {
      if (!fresh.has(ref)) {
        this.removed.set(ref, this.bump())
        this.targets.delete(ref)
        gone.push(old.target.path)
      }
    }
    const pending: LiveRow[] = []
    for (const row of fresh.values()) {
      const old = this.rows.get(row.ref)
      if (!row.error) {
        // Same file (size and raw mtime): keep the summary; otherwise ask the index for this key.
        const summary =
          old?.summary && !old.error && old.size === row.size && old.mtimeMs === row.mtimeMs
            ? old.summary
            : this.readIndex(() => this.index.get(row.target.path, row.size, row.mtimeMs), undefined)
        if (summary) {
          row.summary = summary
          row.pending = false
        } else {
          pending.push(row)
        }
      }
      // Unchanged content keeps its revision, so a second launch's delta is empty.
      row.revision = old && sameRow(old, row) ? old.revision : this.bump()
      this.targets.set(row.ref, row.target)
    }
    this.rows = fresh
    try {
      this.index.remove(gone)
      this.index.putHeads([...fresh.values()].filter(row => !row.error).map(indexHeadOf))
    } catch {
      // The index is a cache: a failed write costs a re-read next launch.
    }
    this.announce()
    this.queue.add(pending)
  }

  private async summarize(row: LiveRow): Promise<void> {
    const adapter = this.hosts.find(host => host.agent === row.target.host)
    try {
      if (!adapter) {
        throw new Error(`${row.target.host}: host is not registered`)
      }
      const result = await summarizeRow(this.platform, this.adapters, row.target)
      if ('error' in result) {
        // Not cached (3.7): the head stays, the numbers stay undefined, and the reason is shown.
        row.error = result.error
      } else {
        row.summary = result.summary
        this.finished.push({ ...indexHeadOf(row), summary: result.summary, prompts: result.prompts })
      }
    } catch (error) {
      // Not cached (3.7): the head stays, the numbers stay undefined, and the reason is shown.
      row.error = parseReadFailure(errorMessage(error), this.platform.home, row.target.path)
    }
    row.pending = false
    row.revision = this.bump()
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined
      this.flush()
    }, FLUSH_MS)
  }

  /** One transaction per batch of finished summaries, then one push to the browsers. */
  private flush(): void {
    const batch = this.finished.splice(0)
    if (batch.length > 0) {
      try {
        this.index.putSummaries(batch)
      } catch {
        // The index is a cache: a failed write costs a re-read next launch.
      }
    }
    this.announce()
  }

  private announce(): void {
    emitSessions({ revision: this.revision, pending: this.pendingCount() })
  }

  private search(query: string): string[] {
    const hits = this.readIndex(() => this.index.search(query), undefined)
    if (hits) {
      return hits.filter(ref => this.rows.has(ref))
    }
    // --no-index, index unavailable or busy: the index's rule over titles and first prompts in memory.
    // Under 3 characters the index also matches substrings, so both lengths are a substring match here.
    const text = query
      .replace(/\p{Cc}/gu, ' ')
      .trim()
      .toLowerCase()
    if (!text) {
      return []
    }
    return this.sortedRows()
      .filter(
        row => (row.title ?? '').toLowerCase().includes(text) || (row.firstPrompt ?? '').toLowerCase().includes(text),
      )
      .map(row => row.ref)
  }

  /** An index error (busy, I/O) never stops the list: the row stays unsummarized or the search runs in memory. */
  private readIndex<T>(read: () => T, fallback: T): T {
    try {
      return read()
    } catch {
      return fallback
    }
  }

  private hostEntries(): HostListEntry[] {
    return this.hostStates.map(state => {
      let count = 0
      for (const row of this.rows.values()) {
        if (row.target.host === state.adapter.agent) {
          count += 1
        }
      }
      const roots =
        state.found.length > 0
          ? state.found
          : state.missing.length > 0
            ? state.missing
            : state.adapter.roots(
                sessionAdapterHome(state.adapter, { env: this.platform.env, home: this.platform.home }),
              )
      const checked = roots.map(path => redactText(path, { home: this.platform.home })).join(', ')
      return {
        id: state.adapter.agent,
        displayName: state.adapter.displayName,
        count,
        ...(count === 0 && checked ? { checked } : {}),
      }
    })
  }

  private sortedRows(): LiveRow[] {
    return [...this.rows.values()].toSorted((a, b) => b.lastActiveAt - a.lastActiveAt)
  }

  private pendingCount(): number {
    let count = 0
    for (const row of this.rows.values()) {
      if (row.pending) {
        count += 1
      }
    }
    return count
  }

  private bump(): number {
    this.revision += 1
    return this.revision
  }
}
