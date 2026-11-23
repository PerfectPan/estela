import type { SessionSummary } from '@rivus/agent-kit/transcript'

/** Head fields from `discover`, keyed by trace id. `size` and `mtimeMs` are the cache key. */
export interface IndexHead {
  traceId: string
  agent: string
  path: string
  size: number
  mtimeMs: number
  sessionId?: string
  title?: string
  cwd?: string
  startedAt?: number
  lastActiveAt?: number
  firstPrompt?: string
}

/**
 * A session's list cost as its summary was priced: the price snapshot's version, the sum over the priced requests
 * (absent when none is priced), and how many requests the sum leaves out (absent when the reader returns no
 * request fields to price).
 */
export interface IndexCost {
  prices: string
  usd?: number
  unpriced?: number
}

/** The summary numbers, with the cost they were priced at. */
export type StoredSummary = SessionSummary & { cost?: IndexCost }

/** A stored row: the head from the last discover pass, and the summary when a current one is cached. */
export interface IndexRow extends IndexHead {
  summary?: StoredSummary
}

export interface IndexSummary extends IndexHead {
  summary: StoredSummary
  /** User prompts in order. The index keeps the first `PROMPT_LIMIT`, `PROMPT_CHARS` each. */
  prompts: string[]
}

export interface SessionIndex {
  readonly file: string
  readonly enabled: boolean
  /** Set when the index could not be opened; the session list then runs without it. */
  readonly unavailable?: string
  /** Every stored row, newest activity first. A second launch shows these before `discover` finishes. */
  rows: () => IndexRow[]
  /** Drop sessions that disappeared from discovery, without removing other sessions in the same file. */
  remove: (traceIds: readonly string[]) => void
  /** The cached summary, only when size, mtime, and the summary version all match. */
  get: (traceId: string, size: number, mtimeMs: number) => StoredSummary | undefined
  /** One transaction for the whole discover batch. A changed key drops the cached summary. */
  putHeads: (rows: readonly IndexHead[]) => void
  /** One transaction per batch. A failed summary is never passed in, so it is never cached. */
  putSummaries: (rows: readonly IndexSummary[]) => void
  /**
   * Trace ids of the sessions whose title or prompts match, newest first. `undefined` when the index is off or the
   * query is blank. 3 or more characters use FTS5 `trigram`; shorter queries are a substring
   * match over titles and prompts, so a 2-character Chinese word works.
   */
  search: (query: string) => string[] | undefined
  close: () => void
}

export interface OpenIndexOptions {
  /** `false` for `--no-index`: nothing is read or written, and no file is created. */
  enabled?: boolean
  /** Override the database file. Tests pass a temporary path. */
  file?: string
  homeDir?: string
  env?: Readonly<Record<string, string | undefined>>
  /**
   * Summary version of the numbers the caller writes; the CLI derives it from the kit's
   * `SESSION_SUMMARY_VERSION`, which owns the summary semantics. A row at another version
   * is recomputed, never served.
   */
  summaryVersion: number
}
