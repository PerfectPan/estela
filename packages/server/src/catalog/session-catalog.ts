import type { IndexSummary, SessionIndex } from '@rivus/estela-runtime-node'
import type { AgentListEntry, ListSessionsQuery, ListSessionsResult, ResolvedSession } from '@rivus/estela-rpc'
import type { Trace } from '@rivus/estela-schema'
import { redactText } from '@rivus/agent-kit/redact'
import { sessionAdapterHome, type SessionAdapter, type SessionAdapters } from '@rivus/agent-kit/sessions'
import { SESSION_SUMMARY_VERSION, type SessionTarget } from '@rivus/agent-kit/transcript'
import { emitSessions } from '@rivus/estela-rpc'
import { openSessionIndex } from '@rivus/estela-runtime-node'
import { agentState, discoverRows, progressOf, type AgentProgress, type AgentState } from './discover.ts'
import {
  activityLabel,
  indexHeadOf,
  publicRow,
  rowFromIndex,
  sameRow,
  summarizeRow,
  type LiveRow,
  type Redactor,
} from './rows.ts'
import type { ShellPlatform } from '../sessions/load-session.ts'
import { createShellPlatform, hardenPlatform } from '../sessions/node-platform.ts'
import { errorMessage, parseReadFailure } from '../sessions/read-failure.ts'
import { oneLine, traceIdOf } from '../sessions/session-target.ts'
import { SummaryQueue } from './summary-queue.ts'
import { adapterDisplayName, builtinAdapters } from '../sessions/adapters.ts'

export type { AgentProgress } from './discover.ts'

const CONCURRENCY = 4
/** A file at least this large is summarized alone (a 355 MB Codex log loads to about 3 GB). */
const HEAVY_BYTES = 64 * 1024 * 1024
/** Finished summaries are written to the index and announced to browsers at most this often. */
const FLUSH_MS = 150
/**
 * Keep kit-based summary versions distinct from version 1, written by the former `host-*`
 * reader packages, whose usage merging and decoding differ. Cache versions are compared for
 * equality, so this offset must stay.
 */
const HOST_ERA_OFFSET = 1
/**
 * Bump this whenever what the index stores for a session (such as its prompt rule) changes
 * without a change to the kit's SESSION_SUMMARY_VERSION, so cached rows are recomputed.
 */
const INDEX_CONTENT_REVISION = 2
const INDEX_SUMMARY_VERSION = SESSION_SUMMARY_VERSION + HOST_ERA_OFFSET + INDEX_CONTENT_REVISION

export interface CatalogOptions {
  /**
   * Omit to enumerate the kit's built-in adapters. When supplied, discovery enumerates only
   * these adapters, while summary reads merge them with the built-ins by agent id.
   */
  adapters?: SessionAdapters
  platform?: ShellPlatform
  index?: SessionIndex
  noIndex?: boolean
  /** Queue summaries without running them until `resumeSummaries()`: the server starts first. */
  deferSummaries?: boolean
}

/**
 * The shell's session catalog: rows from the index and the latest `discover` pass,
 * summaries computed newest (or visible) first at 4 at a time, and trace id → target resolution for
 * the TraceStore, which loads and holds the traces.
 */
export class SessionCatalog {
  private readonly adapters: SessionAdapters | undefined
  private readonly adapterList: readonly SessionAdapter[]
  private readonly platform: ShellPlatform
  private readonly index: SessionIndex
  private readonly redact: Redactor
  private readonly agentStates: AgentState[]
  private rows = new Map<string, LiveRow>()
  /** Trace ids the server resolves: discovered rows and sessions opened from the command line. */
  private readonly targets = new Map<string, SessionTarget>()
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
    this.adapters = options.adapters
    this.adapterList = Object.values(this.adapters ?? builtinAdapters).filter(adapter => adapter !== undefined)
    this.platform = options.platform ? hardenPlatform(options.platform) : createShellPlatform()
    const home = this.platform.home
    // Titles and prompts are session text: redacted like the workspace unless ESTELA_REDACT=0.
    this.redact = this.platform.env.ESTELA_REDACT === '0' ? text => text : text => redactText(text, { home })
    this.index =
      options.index
      ?? openSessionIndex({
        enabled: options.noIndex !== true,
        homeDir: this.platform.home,
        env: this.platform.env,
        summaryVersion: INDEX_SUMMARY_VERSION,
      })
    this.agentStates = this.adapterList.map(agentState)
    this.queue = new SummaryQueue<LiveRow>(
      {
        concurrency: CONCURRENCY,
        key: row => row.traceId,
        rank: row => row.lastActiveAt,
        // An OpenCode row's size is the shared database file; its summary reads rows through the
        // adapter instead of holding the file in memory, so it does not have to run alone.
        heavy: row => row.target.agent !== 'opencode' && row.size >= HEAVY_BYTES,
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
   * for `discover`. `onProgress` reports that pass per agent.
   */
  start(onProgress?: (agents: readonly AgentProgress[]) => void): Promise<void> {
    this.started ??= this.begin(onProgress)
    return this.started
  }

  /** Why the index could not be opened; the catalog then runs as with `--no-index`. */
  get indexUnavailable(): string | undefined {
    // The reason names the cache path: always `~`, whatever ESTELA_REDACT says.
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
   * Register a session given on the command line, already loaded as `trace` (the shell loads it
   * before the server listens). Returns its trace id, which is the file's list row trace id when it has one.
   */
  openPath(target: SessionTarget, trace: Trace): string {
    // Same trace id as the file's list row: the session id counts only in the `path#id` form.
    const traceId = traceIdOf({ ...target, agent: trace.agent || 'estela' })
    this.targets.set(traceId, target)
    return traceId
  }

  /** The TraceStore's resolver: every list row and every opened path. The trace id is the cache key. */
  resolve(traceId: string): ResolvedSession | undefined {
    const target = this.targets.get(traceId)
    return target === undefined ? undefined : { key: traceId, target }
  }

  pickChoices(): { value: string; label: string }[] {
    const names = new Map(this.adapterList.map(adapter => [adapter.agent, adapterDisplayName(adapter)]))
    return this.sortedRows()
      .filter(row => !row.error)
      .map(row => ({
        value: row.traceId,
        label: [
          row.title ? this.redact(row.title) : 'Untitled',
          names.get(row.target.agent) ?? row.target.agent,
          row.project ? this.redact(row.project) : '',
          activityLabel(row.lastActiveAt),
        ]
          .map(oneLine)
          .filter(part => part.length > 0)
          .join(' · '),
      }))
  }

  /**
   * `redact` replaces the catalog's own rule (`ESTELA_REDACT`) for this call's titles, projects, and prompts; the MCP
   * tools pass one that always redacts, because a prompt is shortened after redaction.
   */
  async listSessions(input: ListSessionsQuery = {}, redact: Redactor = this.redact): Promise<ListSessionsResult> {
    await this.start()
    if (input.first && input.first.length > 0) {
      this.queue.prioritize(input.first)
    }
    const since = input.since
    const rows = this.sortedRows()
      .filter(row => since === undefined || row.revision > since)
      .map(row => publicRow(row, redact))
    const removed =
      since === undefined ? [] : [...this.removed].filter(([, at]) => at > since).map(([traceId]) => traceId)
    const query = input.query?.trim() ?? ''
    return {
      agents: this.agentEntries(),
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

  private async begin(onProgress?: (agents: readonly AgentProgress[]) => void): Promise<void> {
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
      this.rows.set(row.traceId, row)
      this.targets.set(row.traceId, row.target)
    }
    this.cachedStart = true
    this.announce()
    this.discovery = run()
    this.discovery.catch(() => {})
  }

  private async discover(onProgress?: (agents: readonly AgentProgress[]) => void): Promise<void> {
    const fresh = await discoverRows(this.agentStates, this.platform, () =>
      onProgress?.(progressOf(this.agentStates, this.platform.home)),
    )
    const gone: string[] = []
    for (const traceId of this.rows.keys()) {
      if (!fresh.has(traceId)) {
        this.removed.set(traceId, this.bump())
        this.targets.delete(traceId)
        gone.push(traceId)
      }
    }
    const pending: LiveRow[] = []
    for (const row of fresh.values()) {
      const old = this.rows.get(row.traceId)
      if (!row.error) {
        // Same file (size and raw mtime): keep the summary; otherwise ask the index for this key.
        const summary =
          old?.summary && !old.error && old.size === row.size && old.mtimeMs === row.mtimeMs
            ? old.summary
            : this.readIndex(() => this.index.get(row.traceId, row.size, row.mtimeMs), undefined)
        if (summary) {
          row.summary = summary
          row.pending = false
        } else {
          pending.push(row)
        }
      }
      // Unchanged content keeps its revision, so a second launch's delta is empty.
      row.revision = old && sameRow(old, row) ? old.revision : this.bump()
      this.targets.set(row.traceId, row.target)
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
    const adapter = this.adapterList.find(candidate => candidate.agent === row.target.agent)
    try {
      if (!adapter) {
        throw new Error(`${row.target.agent}: agent is not registered`)
      }
      const result = await summarizeRow(this.platform, this.adapters, row.target)
      if ('error' in result) {
        // Not cached: the head stays, the numbers stay undefined, and the reason is shown.
        row.error = result.error
      } else {
        row.summary = result.summary
        this.finished.push({ ...indexHeadOf(row), summary: result.summary, prompts: result.prompts })
      }
    } catch (error) {
      // Not cached: the head stays, the numbers stay undefined, and the reason is shown.
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
      return hits.filter(traceId => this.rows.has(traceId))
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
      .map(row => row.traceId)
  }

  /** An index error (busy, I/O) never stops the list: the row stays unsummarized or the search runs in memory. */
  private readIndex<T>(read: () => T, fallback: T): T {
    try {
      return read()
    } catch {
      return fallback
    }
  }

  private agentEntries(): AgentListEntry[] {
    return this.agentStates.map(state => {
      let count = 0
      for (const row of this.rows.values()) {
        if (row.target.agent === state.adapter.agent) {
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
        displayName: adapterDisplayName(state.adapter),
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
