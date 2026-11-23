import type { ListSessionsQuery, ListSessionsResult, SessionListRow } from '@rivus/estela-rpc'
import type * as z from 'zod/mini'
import type { listSessionsInput } from './inputs.ts'
import {
  iso,
  jsonChars,
  pageWithin,
  PATH_CHARS,
  PROMPT_CHARS,
  put,
  shown,
  TITLE_CHARS,
  type Redaction,
} from './bounds.ts'

/** What the session tools read from the session catalog. */
export interface SessionSource {
  /** `redact` is applied to titles, projects, and prompts before the catalog shortens them. */
  listSessions: (query: ListSessionsQuery, redact: (text: string) => string) => Promise<ListSessionsResult>
}

export type SessionFilters = z.output<typeof listSessionsInput>

/** One session in `estela_list_sessions` and `estela_search_sessions`. A count that is absent is not recorded. */
interface SessionItem {
  traceId: string
  agent: string
  title?: string
  project?: string
  /** With `~` for the home directory. */
  cwd?: string
  startedAt?: string
  lastActiveAt: string
  sizeBytes: number
  firstPrompt?: string
  /** `pending`: the counts are not computed yet; `failed`: the session could not be read (`error`). */
  summary: 'ready' | 'pending' | 'failed'
  turns?: number
  requests?: number
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  compactions?: number
  subagents?: number
  failedTools?: number
  /**
   * List price of the session's priced requests at `SessionPage.pricesVersion`; absent when none is priced or the
   * summary is not done. Never 0 for "unknown".
   */
  costUsd?: number
  /**
   * Requests the cost leaves out (no usage, no model, or no price); 0 when every request is priced or there are none.
   * Absent while the summary is pending or failed, or when the reader gives no request usage to price.
   */
  unpricedRequests?: number
  error?: { reason: string; file?: string; line?: number }
  /** Fields cut to their bound, as paths. */
  truncated?: string[][]
}

export interface SessionPage {
  sessions: SessionItem[]
  /** Sessions that match, over every page. */
  total: number
  offset: number
  /** Present when more sessions match: pass it as `offset`. */
  nextOffset?: number
  /**
   * Sessions that pass every other filter but whose counts were still not computed after the wait, so
   * `hasCompaction` or `hasFailedTools` could not test them. They are not in `sessions` or `total`; ask again later.
   */
  unsummarized?: number
  /** Every agent the server reads, with its session count. */
  agents: { id: string; sessions: number }[]
  /** The price snapshot every session item's `costUsd` is priced at. */
  pricesVersion: string
}

type Verdict = 'match' | 'no' | 'unsummarized'

const COUNTS = [
  'turns',
  'requests',
  'inputTokens',
  'outputTokens',
  'durationMs',
  'compactions',
  'subagents',
  'failedTools',
  'costUsd',
  'unpricedRequests',
] as const

function flagVerdict(row: SessionListRow, value: number | undefined, wanted: boolean | undefined): Verdict {
  if (wanted === undefined) {
    return 'match'
  }
  if (row.error) {
    return 'no'
  }
  if (row.pending) {
    return 'unsummarized'
  }
  if (value === undefined) {
    return 'no'
  }
  return value > 0 === wanted ? 'match' : 'no'
}

/** A directory as rows show it: redacted to `~`, without a trailing slash. */
function directoryOf(path: string, redact: (text: string) => string): string {
  const dir = redact(path)
  return dir.length > 1 ? dir.replace(/\/+$/, '') : dir
}

function verdict(row: SessionListRow, filters: SessionFilters, redact: (text: string) => string): Verdict {
  if (filters.agent !== undefined && row.agent !== filters.agent) {
    return 'no'
  }
  if (filters.project !== undefined && !(row.project ?? '').toLowerCase().includes(filters.project.toLowerCase())) {
    return 'no'
  }
  if (filters.cwd !== undefined) {
    const dir = directoryOf(filters.cwd, redact)
    if (row.cwd === undefined || (row.cwd !== dir && !row.cwd.startsWith(dir === '/' ? '/' : `${dir}/`))) {
      return 'no'
    }
  }
  if (filters.since !== undefined && row.lastActiveAt < Date.parse(filters.since)) {
    return 'no'
  }
  if (filters.until !== undefined && (row.startedAt ?? row.lastActiveAt) > Date.parse(filters.until)) {
    return 'no'
  }
  const compaction = flagVerdict(row, row.compactions, filters.hasCompaction)
  const failed = flagVerdict(row, row.failedTools, filters.hasFailedTools)
  if (compaction === 'no' || failed === 'no') {
    return 'no'
  }
  return compaction === 'unsummarized' || failed === 'unsummarized' ? 'unsummarized' : 'match'
}

function itemOf(row: SessionListRow, redaction: Redaction): SessionItem {
  const truncated: string[][] = []
  const text = (field: 'title' | 'project' | 'cwd' | 'firstPrompt', value: string | undefined, max: number) => {
    if (value === undefined) {
      return undefined
    }
    const cut = shown(value, max, redaction)
    if (cut.cut) {
      truncated.push([field])
    }
    return cut.text
  }
  const item: SessionItem = {
    traceId: row.traceId,
    agent: row.agent,
    lastActiveAt: iso(row.lastActiveAt),
    sizeBytes: row.sizeBytes,
    summary: row.error ? 'failed' : row.pending ? 'pending' : 'ready',
  }
  put(item, 'title', text('title', row.title, TITLE_CHARS))
  put(item, 'project', text('project', row.project, TITLE_CHARS))
  put(item, 'cwd', text('cwd', row.cwd, PATH_CHARS))
  put(item, 'startedAt', row.startedAt === undefined ? undefined : iso(row.startedAt))
  // The catalog shortens the prompt for its preview after redacting it; it is cut further here.
  put(item, 'firstPrompt', text('firstPrompt', row.firstPrompt, PROMPT_CHARS))
  for (const key of COUNTS) {
    put(item, key, row[key])
  }
  if (row.error) {
    const error: SessionItem['error'] = { reason: shown(row.error.reason, PROMPT_CHARS, redaction).text }
    put(error, 'file', row.error.file === undefined ? undefined : shown(row.error.file, PATH_CHARS, redaction).text)
    put(error, 'line', row.error.line)
    item.error = error
  }
  if (truncated.length > 0) {
    item.truncated = truncated
  }
  return redaction.value(item)
}

/**
 * A flag filter waits this long, at most, for the counts of the sessions it cannot test yet (a first start
 * summarizes every session in the background); those still missing are reported as `unsummarized`.
 */
const SUMMARY_WAIT_MS = 5000
const WAIT_STEP_MS = 100

/** Matching rows, and the trace ids of the rows a flag filter could not test yet. */
function sortRows(
  listed: ListSessionsResult,
  filters: SessionFilters & { query?: string },
  redact: (text: string) => string,
): { rows: SessionListRow[]; unsummarized: string[] } {
  const found = filters.query === undefined ? undefined : new Set(listed.matches ?? [])
  const rows: SessionListRow[] = []
  const unsummarized: string[] = []
  for (const row of listed.rows) {
    if (found && !found.has(row.traceId)) {
      continue
    }
    const seen = verdict(row, filters, redact)
    if (seen === 'match') {
      rows.push(row)
    } else if (seen === 'unsummarized') {
      unsummarized.push(row.traceId)
    }
  }
  return { rows, unsummarized }
}

/**
 * Sessions newest activity first, filtered, one page. With `query`, only the sessions the index (or, without one,
 * the same rule in memory) finds by title and the user's prompts. Each item is redacted before it is measured.
 */
export async function listSessionPage(
  source: SessionSource,
  filters: SessionFilters & { query?: string },
  redaction: Redaction,
  waitMs = SUMMARY_WAIT_MS,
): Promise<SessionPage> {
  const deadline = Date.now() + waitMs
  const query: ListSessionsQuery = filters.query === undefined ? {} : { query: filters.query }
  let listed = await source.listSessions(query, redaction.text)
  const known = listed.agents.map(agent => agent.id)
  if (filters.agent !== undefined && !known.includes(filters.agent)) {
    throw new TypeError(`unknown agent ${JSON.stringify(filters.agent)}; this server reads ${known.join(', ')}`)
  }
  let sorted = sortRows(listed, filters, redaction.text)
  while (sorted.unsummarized.length > 0 && Date.now() < deadline) {
    // The flag filters need counts: summarize those sessions first, and look again shortly.
    await source.listSessions({ first: sorted.unsummarized.slice(0, 500) }, redaction.text)
    await new Promise(resolve => setTimeout(resolve, WAIT_STEP_MS))
    listed = await source.listSessions(query, redaction.text)
    sorted = sortRows(listed, filters, redaction.text)
  }
  const { rows } = sorted
  const unsummarized = sorted.unsummarized.length
  const offset = filters.offset ?? 0
  const base: SessionPage = {
    sessions: [],
    total: rows.length,
    offset,
    agents: listed.agents.map(agent => ({ id: agent.id, sessions: agent.count })),
    pricesVersion: listed.pricesVersion,
  }
  if (unsummarized > 0) {
    base.unsummarized = unsummarized
  }
  const page = pageWithin(
    rows,
    { offset, limit: filters.limit ?? 20 },
    row => itemOf(row, redaction),
    jsonChars(base) + jsonChars({ nextOffset: rows.length }),
  )
  const out: SessionPage = { ...base, sessions: page.items }
  put(out, 'nextOffset', page.nextOffset)
  return out
}
