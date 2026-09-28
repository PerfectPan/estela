import type { HostAdapter, HostEnv, SessionRef, TraceIO } from '@rivus/agent-trace-kernel'
import type { IndexSummary, SessionIndex } from '@rivus/agent-trace-runtime-node'
import type { HostListEntry, ListSessionsQuery, ListSessionsResult, SessionService, SessionView } from '@rivus/agent-trace-rpc'
import type { Trace } from '@rivus/agent-trace-schema'
import { loadTrace, redactText, splitSessionRef } from '@rivus/agent-trace-kernel'
import { emitSessions } from '@rivus/agent-trace-rpc'
import { homeDir, nodeIO, openSessionIndex } from '@rivus/agent-trace-runtime-node'
import { discoverRows, hostState, progressOf, type HostProgress, type HostState } from './catalog-discover.ts'
import { activityLabel, indexHeadOf, publicRow, rowFromIndex, sameRow, summarizeRow, type LiveRow, type Redactor } from './catalog-rows.ts'
import { errorMessage, parseReadFailure } from './read-failure.ts'
import { registeredHosts, Session } from './session.ts'
import { oneLine, sessionRefId } from './session-ref.ts'
import { SummaryQueue } from './summary-queue.ts'

export type { HostProgress } from './catalog-discover.ts'

const CONCURRENCY = 4
/** A file at least this large is summarized alone (a 355 MB Codex log loads to about 3 GB). */
const HEAVY_BYTES = 64 * 1024 * 1024
/** Finished summaries are written to the index and announced to browsers at most this often. */
const FLUSH_MS = 150
/** Loaded traces kept in memory (plan 3.5). */
const HELD_TRACES = 3

export interface CatalogOptions {
  hosts?: readonly HostAdapter[]
  io?: TraceIO
  env?: HostEnv
  index?: SessionIndex
  noIndex?: boolean
  /** Queue summaries without running them until `resumeSummaries()`: the server starts first. */
  deferSummaries?: boolean
}

/**
 * The shell's session service (plan 3.4): rows from the index and the latest `discover` pass,
 * summaries computed newest (or visible) first at 4 at a time, and ref → file resolution.
 */
export class SessionCatalog implements SessionService {
  private readonly hosts: readonly HostAdapter[]
  private readonly io: TraceIO
  private readonly env: HostEnv
  private readonly index: SessionIndex
  private readonly redact: Redactor
  private readonly hostStates: HostState[]
  private rows = new Map<string, LiveRow>()
  /** Refs the server resolves: discovered rows and paths opened from the command line. */
  private readonly targets = new Map<string, SessionRef | string>()
  /** Rows that disappeared in a re-read, by the revision they were removed at. */
  private readonly removed = new Map<string, number>()
  private readonly held = new Map<string, Session>()
  private readonly queue: SummaryQueue<LiveRow>
  private readonly finished: IndexSummary[] = []
  private started: Promise<void> | undefined
  private discovery: Promise<void> | undefined
  private cachedStart = false
  private current: string | undefined
  private revision = 0
  private flushTimer: ReturnType<typeof setTimeout> | undefined

  constructor(options: CatalogOptions = {}) {
    this.hosts = options.hosts ?? registeredHosts
    this.io = options.io ?? nodeIO
    this.env = options.env ?? { homeDir: homeDir(), env: process.env }
    const home = this.env.homeDir
    // Titles and prompts are session text: redacted like the workspace unless AGENT_TRACE_REDACT=0.
    this.redact = this.env.env.AGENT_TRACE_REDACT === '0' ? text => text : text => redactText(text, home)
    this.index = options.index ?? openSessionIndex({
      enabled: options.noIndex !== true,
      homeDir: this.env.homeDir,
      env: this.env.env,
    })
    this.hostStates = this.hosts.map(hostState)
    this.queue = new SummaryQueue<LiveRow>({
      concurrency: CONCURRENCY,
      key: row => row.ref,
      rank: row => row.lastActiveAt,
      heavy: row => row.size >= HEAVY_BYTES,
      run: row => this.summarize(row),
    }, options.deferSummaries === true)
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
    return this.index.unavailable ? redactText(this.index.unavailable, this.env.homeDir) : undefined
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

  /** Load a path given on the command line. Throws, before the server listens, when it cannot be read. */
  async openPath(input: string): Promise<string> {
    const trace = await loadTrace(input, this.hosts, this.io)
    const { file, sessionId } = splitSessionRef(input)
    // Same ref as the file's list row: the session id counts only in the `path#id` form.
    const ref = sessionRefId({ host: trace.host.id || 'agent-trace', path: file, ...(sessionId ? { sessionId } : {}) })
    this.targets.set(ref, input)
    this.hold(ref, file, trace)
    return ref
  }

  pickChoices(): { value: string, label: string }[] {
    const names = new Map(this.hosts.map(host => [host.id, host.displayName]))
    return this.sortedRows().filter(row => !row.error).map(row => ({
      value: row.ref,
      label: [row.title ? this.redact(row.title) : 'Untitled', names.get(row.target.host) ?? row.target.host, row.project ? this.redact(row.project) : '', activityLabel(row.lastActiveAt)]
        .map(oneLine)
        .filter(part => part.length > 0)
        .join(' · '),
    }))
  }

  /** The session opened last, for `get-trace` and `reconstruct` without a ref. */
  async view(): Promise<SessionView> {
    if (!this.current)
      throw new Error('No session is open')
    return this.sessionTrace(this.current)
  }

  async sessionTrace(ref: string): Promise<SessionView> {
    const existing = this.held.get(ref)
    if (existing) {
      this.touch(ref, existing)
      return existing.view()
    }
    const target = this.targets.get(ref)
    if (target === undefined)
      throw new Error(`Unknown session ${ref}`)
    const trace = await loadTrace(target, this.hosts, this.io)
    const path = typeof target === 'string' ? splitSessionRef(target).file : target.path
    return this.hold(ref, path, trace).view()
  }

  async listSessions(input: ListSessionsQuery = {}): Promise<ListSessionsResult> {
    await this.start()
    if (input.first && input.first.length > 0)
      this.queue.prioritize(input.first)
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
    if (this.flushTimer)
      clearTimeout(this.flushTimer)
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
      const row = rowFromIndex(entry, this.env.homeDir)
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
    const fresh = await discoverRows(this.hostStates, this.io, this.env, () => onProgress?.(progressOf(this.hostStates, this.env.homeDir)))
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
        const summary = old?.summary && !old.error && old.size === row.size && old.mtimeMs === row.mtimeMs
          ? old.summary
          : this.readIndex(() => this.index.get(row.target.path, row.size, row.mtimeMs), undefined)
        if (summary) {
          row.summary = summary
          row.pending = false
        }
        else {
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
    }
    catch {
      // The index is a cache: a failed write costs a re-read next launch.
    }
    this.announce()
    this.queue.add(pending)
  }

  private async summarize(row: LiveRow): Promise<void> {
    const adapter = this.hosts.find(host => host.id === row.target.host)
    try {
      if (!adapter)
        throw new Error(`${row.target.host}: host is not registered`)
      const result = await summarizeRow(adapter, row.target, this.io)
      row.summary = result.summary
      this.finished.push({ ...indexHeadOf(row), summary: result.summary, prompts: result.prompts })
    }
    catch (error) {
      // Not cached (3.7): the head stays, the numbers stay undefined, and the reason is shown.
      row.error = parseReadFailure(errorMessage(error), this.env.homeDir, row.target.path)
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
      }
      catch {
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
    if (hits)
      return hits.filter(ref => this.rows.has(ref))
    // --no-index, index unavailable or busy: the index's rule over titles and first prompts in memory.
    // Under 3 characters the index also matches substrings, so both lengths are a substring match here.
    const text = query.replace(/\p{Cc}/gu, ' ').trim().toLowerCase()
    if (!text)
      return []
    return this.sortedRows()
      .filter(row => (row.title ?? '').toLowerCase().includes(text) || (row.firstPrompt ?? '').toLowerCase().includes(text))
      .map(row => row.ref)
  }

  /** An index error (busy, I/O) never stops the list: the row stays unsummarized or the search runs in memory. */
  private readIndex<T>(read: () => T, fallback: T): T {
    try {
      return read()
    }
    catch {
      return fallback
    }
  }

  private hostEntries(): HostListEntry[] {
    return this.hostStates.map((state) => {
      let count = 0
      for (const row of this.rows.values()) {
        if (row.target.host === state.adapter.id)
          count += 1
      }
      const roots = state.found.length > 0 ? state.found : (state.missing.length > 0 ? state.missing : state.adapter.roots(this.env))
      const checked = roots.map(path => redactText(path, this.env.homeDir)).join(', ')
      return {
        id: state.adapter.id,
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
      if (row.pending)
        count += 1
    }
    return count
  }

  private bump(): number {
    this.revision += 1
    return this.revision
  }

  private hold(ref: string, path: string, trace: Trace): Session {
    const session = new Session(path, false, trace)
    this.touch(ref, session)
    while (this.held.size > HELD_TRACES) {
      const oldest = this.held.keys().next().value
      if (oldest === undefined)
        break
      this.held.delete(oldest)
    }
    return session
  }

  private touch(ref: string, session: Session): void {
    this.held.delete(ref)
    this.held.set(ref, session)
    this.current = ref
  }
}
