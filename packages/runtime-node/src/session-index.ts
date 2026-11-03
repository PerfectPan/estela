import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as z from 'zod/mini'
import { isTransient, openDatabase } from './session-index-schema.ts'

/** User prompts kept per session: the first 200, 500 characters each. */
export const PROMPT_LIMIT = 200
export const PROMPT_CHARS = 500

/** Head fields from `discover`, keyed by path. `size` and `mtimeMs` are the cache key. */
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

/** A stored row: the head from the last discover pass, and the summary when a current one is cached. */
export interface IndexRow extends IndexHead {
  summary?: SessionSummary
}

export interface IndexSummary extends IndexHead {
  summary: SessionSummary
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
  /** Drop rows whose files are gone. */
  remove: (paths: readonly string[]) => void
  /** The cached summary, only when size, mtime, and the summary version all match. */
  get: (path: string, size: number, mtimeMs: number) => SessionSummary | undefined
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

/** `$XDG_CACHE_HOME/rivus-agent-trace/index.sqlite`, else `~/.cache/rivus-agent-trace/index.sqlite`. */
export function sessionIndexFile(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): string {
  const xdg = env.XDG_CACHE_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(home, '.cache')
  return join(base, 'rivus-agent-trace', 'index.sqlite')
}

const SUMMARY_COLUMNS = [
  ['turns', 'turns'],
  ['requests', 'requests'],
  ['tokens_in', 'inputTokens'],
  ['tokens_out', 'outputTokens'],
  ['duration_ms', 'durationMs'],
  ['compactions', 'compactions'],
  ['subagents', 'subagents'],
  ['failed_tools', 'failedTools'],
] as const

const HEAD_TEXT = [
  ['session_id', 'sessionId'],
  ['title', 'title'],
  ['cwd', 'cwd'],
  ['first_prompt', 'firstPrompt'],
] as const
const HEAD_NUMBERS = [
  ['started_at', 'startedAt'],
  ['last_active_at', 'lastActiveAt'],
] as const

const textColumn = z.nullable(z.string())
const numberColumn = z.nullable(z.number())

/**
 * Row schemas, one per SELECT: each SELECT names its schema's columns, plus `id` where a row that does not parse is
 * dropped. The index is a cache, so a head that does not parse is deleted with its prompts and search row, and the next
 * discover pass writes it again; a summary that does not parse is not served and is recomputed.
 */
const headRow = z.object({
  trace_id: z.string(),
  agent: z.string(),
  path: z.string(),
  size: z.number(),
  mtime: z.number(),
  session_id: textColumn,
  title: textColumn,
  cwd: textColumn,
  first_prompt: textColumn,
  started_at: numberColumn,
  last_active_at: numberColumn,
})
const summaryRow = z.object({
  summary_version: numberColumn,
  turns: numberColumn,
  requests: numberColumn,
  tokens_in: numberColumn,
  tokens_out: numberColumn,
  duration_ms: numberColumn,
  compactions: numberColumn,
  subagents: numberColumn,
  failed_tools: numberColumn,
  context_shape: textColumn,
})
const idRow = z.object({ id: z.number() })
const traceIdRow = z.object({ trace_id: z.string() })
const promptRow = z.object({ text: z.string() })
const contextShape = z.array(z.number())

const HEAD_SELECT = Object.keys(headRow.shape).join(', ')
const SUMMARY_SELECT = Object.keys(summaryRow.shape).join(', ')

function casefold(text: string): string {
  return text.toLowerCase()
}

function clip(text: string): string {
  return text.slice(0, PROMPT_CHARS)
}

/** A NULL or empty column stays `undefined`. */
function headOf(row: z.output<typeof headRow>): IndexHead {
  const { trace_id: traceId, agent, path, size, mtime: mtimeMs } = row
  const head: IndexHead = { traceId, agent, path, size, mtimeMs }
  for (const [column, key] of HEAD_TEXT) {
    const value = row[column]
    if (value) {
      head[key] = value
    }
  }
  for (const [column, key] of HEAD_NUMBERS) {
    const value = row[column]
    if (value !== null) {
      head[key] = value
    }
  }
  return head
}

function traceIdsOf(rows: readonly unknown[]): string[] {
  return rows.flatMap(row => z.safeParse(traceIdRow, row).data?.trace_id ?? [])
}

/** A damaged shape is missing data; the other numbers stay. */
function contextShapeOf(stored: string): number[] | undefined {
  try {
    return z.safeParse(contextShape, JSON.parse(stored)).data
  } catch {
    return undefined
  }
}

class SqliteIndex implements SessionIndex {
  readonly enabled = true
  readonly file: string
  private readonly db: DatabaseSync
  private readonly version: number
  private readonly statements = new Map<string, StatementSync>()

  constructor(file: string, db: DatabaseSync, version: number) {
    this.file = file
    this.db = db
    this.version = version
    // One case fold for the query and the stored text; SQLite's lower() folds ASCII only. Known-union narrowing:
    // `value` is node:sqlite's `SQLOutputValue`, and only its text member is folded.
    db.function('casefold', { deterministic: true }, value => (typeof value === 'string' ? casefold(value) : value))
  }

  rows(): IndexRow[] {
    const rows = this.sql(
      `SELECT id, ${HEAD_SELECT}, ${SUMMARY_SELECT} FROM sessions ORDER BY last_active_at DESC`,
    ).all()
    const out: IndexRow[] = []
    const unparsable: unknown[] = []
    for (const row of rows) {
      const head = z.safeParse(headRow, row).data
      if (!head) {
        unparsable.push(row)
        continue
      }
      const entry: IndexRow = headOf(head)
      const summary = this.summaryOf(row)
      if (summary) {
        entry.summary = summary
      }
      out.push(entry)
    }
    if (unparsable.length > 0) {
      try {
        this.transaction(() => this.dropUnparsable(unparsable))
      } catch {
        // The cleanup is optional: on any error (busy, full, read-only, I/O) the rows read above are still returned,
        // the damaged rows stay hidden, and `writeHead` drops each one when discover writes its path.
      }
    }
    return out
  }

  get(path: string, size: number, mtimeMs: number): SessionSummary | undefined {
    return this.summaryOf(
      this.sql(`SELECT ${SUMMARY_SELECT} FROM sessions WHERE path = ? AND size = ? AND mtime = ?`).get(
        path,
        size,
        mtimeMs,
      ),
    )
  }

  remove(paths: readonly string[]): void {
    if (paths.length === 0) {
      return
    }
    this.transaction(() => {
      this.drop(paths.map(path => this.sql('SELECT id FROM sessions WHERE path = ?').get(path)))
    })
  }

  putHeads(rows: readonly IndexHead[]): void {
    if (rows.length > 0) {
      this.transaction(() => rows.forEach(row => this.writeHead(row)))
    }
  }

  putSummaries(rows: readonly IndexSummary[]): void {
    if (rows.length > 0) {
      this.transaction(() => rows.forEach(row => this.writeSummary(row)))
    }
  }

  search(query: string): string[] | undefined {
    // NUL and other control characters are not search text.
    const text = query.replace(/\p{Cc}/gu, ' ').trim()
    if (!text) {
      return undefined
    }
    try {
      if (Array.from(text).length < 3) {
        const pattern = `%${casefold(text).replace(/[\\%_]/g, match => `\\${match}`)}%`
        // Two plain `?` parameters: node:sqlite in early Node 24 releases (24.0) cannot bind a positional argument to `?1`.
        const rows = this.sql(
          `SELECT trace_id FROM sessions WHERE casefold(title) LIKE ? ESCAPE '\\'
             OR trace_id IN (SELECT trace_id FROM prompts WHERE casefold(text) LIKE ? ESCAPE '\\')
           ORDER BY last_active_at DESC`,
        ).all(pattern, pattern)
        return traceIdsOf(rows)
      }
      // One quoted phrase: FTS5 operators in the query are plain text. `trigram` folds case itself.
      const phrase = `"${text.replaceAll('"', '""')}"`
      const rows = this.sql(
        `SELECT sessions.trace_id AS trace_id FROM search JOIN sessions ON sessions.id = search.rowid
         WHERE search MATCH ? ORDER BY sessions.last_active_at DESC`,
      ).all(phrase)
      return traceIdsOf(rows)
    } catch (error) {
      // A concurrent process holds the lock or is rebuilding (busy or I/O): let the caller search in
      // memory. Anything else is a query that matches nothing.
      return isTransient(error) ? undefined : []
    }
  }

  close(): void {
    this.db.close()
  }

  /** Prepared once per SQL text: 2,000+ rows per launch go through the same few statements. */
  private sql(text: string): StatementSync {
    let statement = this.statements.get(text)
    if (!statement) {
      statement = this.db.prepare(text)
      this.statements.set(text, statement)
    }
    return statement
  }

  /** A NULL column is a capability the agent does not record: it stays `undefined`, never 0. */
  private summaryOf(stored: unknown): SessionSummary | undefined {
    const row = z.safeParse(summaryRow, stored).data
    if (row?.summary_version !== this.version) {
      return undefined
    }
    const summary: SessionSummary = {}
    for (const [column, key] of SUMMARY_COLUMNS) {
      const value = row[column]
      if (value !== null) {
        summary[key] = value
      }
    }
    const shape = row.context_shape === null ? undefined : contextShapeOf(row.context_shape)
    if (shape) {
      summary.contextShape = shape
    }
    return summary
  }

  private writeHead(row: IndexHead): void {
    const found = this.sql(`SELECT id, ${HEAD_SELECT} FROM sessions WHERE path = ?`).get(row.path)
    const stored = z.safeParse(headRow, found).data
    if (found && !stored) {
      // Its old trace id is unknown, so its prompts go with it here, and the row is written fresh below.
      this.drop([found])
    }
    const next = { ...row, ...(row.firstPrompt ? { firstPrompt: clip(row.firstPrompt) } : {}) }
    const existing = stored ? headOf(stored) : undefined
    const sameKey =
      existing !== undefined
      && existing.size === row.size
      && existing.mtimeMs === row.mtimeMs
      && existing.traceId === row.traceId
    // Unchanged file and head: nothing to write. This is every row on a second launch.
    if (sameKey && [...HEAD_TEXT, ...HEAD_NUMBERS].every(([, key]) => existing[key] === next[key])) {
      return
    }
    this.sql(
      `INSERT INTO sessions (path, trace_id, agent, size, mtime, session_id, title, cwd, first_prompt, started_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         trace_id = excluded.trace_id, agent = excluded.agent, size = excluded.size, mtime = excluded.mtime,
         session_id = excluded.session_id, title = excluded.title, cwd = excluded.cwd,
         first_prompt = excluded.first_prompt, started_at = excluded.started_at, last_active_at = excluded.last_active_at`,
    ).run(
      row.path,
      row.traceId,
      row.agent,
      row.size,
      row.mtimeMs,
      ...HEAD_TEXT.map(([, key]) => next[key] ?? null),
      ...HEAD_NUMBERS.map(([, key]) => next[key] ?? null),
    )
    if (sameKey) {
      this.rewriteSearch(row.path, next.title, this.promptsOf(row.traceId))
      return
    }
    this.sql(
      `UPDATE sessions SET summary_version = NULL, ${SUMMARY_COLUMNS.map(([column]) => `${column} = NULL`).join(', ')},
       context_shape = NULL WHERE path = ?`,
    ).run(row.path)
    if (existing && existing.traceId !== row.traceId) {
      this.sql('DELETE FROM prompts WHERE trace_id = ?').run(existing.traceId)
    }
    const prompts = next.firstPrompt ? [next.firstPrompt] : []
    this.replacePrompts(row.traceId, prompts)
    this.rewriteSearch(row.path, next.title, prompts)
  }

  private writeSummary(row: IndexSummary): void {
    this.writeHead(row)
    const prompts = row.prompts
      .slice(0, PROMPT_LIMIT)
      .map(clip)
      .filter(text => text.length > 0)
    const shape = row.summary.contextShape
    this.sql(
      `UPDATE sessions SET summary_version = ?, ${SUMMARY_COLUMNS.map(([column]) => `${column} = ?`).join(', ')},
       context_shape = ? WHERE path = ?`,
    ).run(
      this.version,
      ...SUMMARY_COLUMNS.map(([, key]) => row.summary[key] ?? null),
      shape ? JSON.stringify(shape) : null,
      row.path,
    )
    this.replacePrompts(row.traceId, prompts)
    this.rewriteSearch(row.path, row.title, prompts)
  }

  /**
   * Deletes each found session row (`{ id }`; anything else is skipped) with its prompts and search row. Prompts are
   * matched through the stored `trace_id` in SQL, so a row whose `trace_id` does not parse loses its prompts too.
   */
  private drop(found: readonly unknown[]): void {
    for (const row of found) {
      const id = z.safeParse(idRow, row).data?.id
      if (id === undefined) {
        continue
      }
      this.sql('DELETE FROM search WHERE rowid = ?').run(id)
      this.sql('DELETE FROM prompts WHERE trace_id IN (SELECT trace_id FROM sessions WHERE id = ?)').run(id)
      this.sql('DELETE FROM sessions WHERE id = ?').run(id)
    }
  }

  /**
   * Re-reads each stale row by id inside the transaction and drops it only if its head still does not parse: since the
   * caller read it, another process's `writeHead` may have written a valid row under the same id (no AUTOINCREMENT).
   */
  private dropUnparsable(stale: readonly unknown[]): void {
    const select = this.sql(`SELECT id, ${HEAD_SELECT} FROM sessions WHERE id = ?`)
    const current = stale.flatMap(row => z.safeParse(idRow, row).data?.id ?? []).map(id => select.get(id))
    this.drop(current.filter(row => row !== undefined && !z.safeParse(headRow, row).success))
  }

  private promptsOf(traceId: string): string[] {
    return this.sql('SELECT text FROM prompts WHERE trace_id = ? ORDER BY seq')
      .all(traceId)
      .flatMap(row => z.safeParse(promptRow, row).data?.text ?? [])
  }

  private replacePrompts(traceId: string, prompts: readonly string[]): void {
    this.sql('DELETE FROM prompts WHERE trace_id = ?').run(traceId)
    const insert = this.sql('INSERT INTO prompts (trace_id, seq, text) VALUES (?, ?, ?)')
    prompts.forEach((text, seq) => insert.run(traceId, seq, text))
  }

  /** One FTS row per session, keyed by `sessions.id`, so a rewrite is two lookups by rowid. */
  private rewriteSearch(path: string, title: string | undefined, prompts: readonly string[]): void {
    const session = z.safeParse(idRow, this.sql('SELECT id FROM sessions WHERE path = ?').get(path)).data
    if (!session) {
      return
    }
    this.sql('DELETE FROM search WHERE rowid = ?').run(session.id)
    if (title || prompts.length > 0) {
      this.sql('INSERT INTO search (rowid, title, prompts) VALUES (?, ?, ?)').run(
        session.id,
        title ?? '',
        prompts.join('\n'),
      )
    }
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      fn()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

function disabledIndex(file: string, unavailable?: string): SessionIndex {
  return {
    file,
    enabled: false,
    ...(unavailable ? { unavailable } : {}),
    rows: () => [],
    remove: () => {},
    get: () => undefined,
    putHeads: () => {},
    putSummaries: () => {},
    search: () => undefined,
    close: () => {},
  }
}

/** Never throws: an index that cannot be opened (EACCES, read-only home) is returned disabled, with the reason. */
export function openSessionIndex(options: OpenIndexOptions): SessionIndex {
  const file = options.file ?? sessionIndexFile(options.env ?? process.env, options.homeDir ?? homedir())
  if (options.enabled === false) {
    return disabledIndex(file)
  }
  try {
    return new SqliteIndex(file, openDatabase(file), options.summaryVersion)
  } catch (error) {
    return disabledIndex(file, error instanceof Error ? error.message : String(error))
  }
}
