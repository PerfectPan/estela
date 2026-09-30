import type { SessionSummary } from '@rivus/agent-trace-kernel'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SUMMARY_VERSION } from '@rivus/agent-trace-kernel'
import { openDatabase } from './session-index-schema.ts'

/** User prompts kept per session (plan 3.4): the first 200, 500 characters each. */
export const PROMPT_LIMIT = 200
export const PROMPT_CHARS = 500

/** Head fields from `discover`, keyed by path. `size` and `mtimeMs` are the cache key. */
export interface IndexHead {
  ref: string
  host: string
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
   * Refs whose title or prompts match, newest first. `undefined` when the index is off or the
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
  /** Tests only: pretend the summary numbers have another version. */
  summaryVersion?: number
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

/** Never throws: an index that cannot be opened (EACCES, read-only home) is returned disabled, with the reason. */
export function openSessionIndex(options: OpenIndexOptions = {}): SessionIndex {
  const file = options.file ?? sessionIndexFile(options.env ?? process.env, options.homeDir ?? homedir())
  if (options.enabled === false)
    return disabledIndex(file)
  try {
    return new SqliteIndex(file, openDatabase(file), options.summaryVersion ?? SUMMARY_VERSION)
  }
  catch (error) {
    return disabledIndex(file, error instanceof Error ? error.message : String(error))
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

const SUMMARY_COLUMNS = [
  ['turns', 'turns'],
  ['requests', 'requests'],
  ['tokens_in', 'tokensIn'],
  ['tokens_out', 'tokensOut'],
  ['duration_ms', 'durationMs'],
  ['compactions', 'compactions'],
  ['subagents', 'subagents'],
  ['failed_tools', 'failedTools'],
] as const

const HEAD_TEXT = [['session_id', 'sessionId'], ['title', 'title'], ['cwd', 'cwd'], ['first_prompt', 'firstPrompt']] as const
const HEAD_NUMBERS = [['started_at', 'startedAt'], ['last_active_at', 'lastActiveAt']] as const

const SUMMARY_SELECT = `summary_version, ${SUMMARY_COLUMNS.map(([column]) => column).join(', ')}, context_shape`
const HEAD_SELECT = `ref, host, path, size, mtime, ${[...HEAD_TEXT, ...HEAD_NUMBERS].map(([column]) => column).join(', ')}`

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
    // One case fold for the query and the stored text; SQLite's lower() folds ASCII only.
    db.function('casefold', { deterministic: true }, value => typeof value === 'string' ? casefold(value) : value)
  }

  rows(): IndexRow[] {
    const rows = this.sql(`SELECT ${HEAD_SELECT}, ${SUMMARY_SELECT} FROM sessions ORDER BY last_active_at DESC`).all() as Record<string, unknown>[]
    return rows.map((row) => {
      const out: IndexRow = { ...headOf(row) }
      const summary = this.summaryOf(row)
      if (summary)
        out.summary = summary
      return out
    })
  }

  get(path: string, size: number, mtimeMs: number): SessionSummary | undefined {
    const row = this.sql(`SELECT ${SUMMARY_SELECT} FROM sessions WHERE path = ? AND size = ? AND mtime = ?`)
      .get(path, size, mtimeMs) as Record<string, unknown> | undefined
    return row ? this.summaryOf(row) : undefined
  }

  remove(paths: readonly string[]): void {
    if (paths.length === 0)
      return
    this.transaction(() => {
      for (const path of paths) {
        const row = this.sql('SELECT id, ref FROM sessions WHERE path = ?').get(path) as { id: number | bigint, ref: string } | undefined
        if (!row)
          continue
        this.sql('DELETE FROM search WHERE rowid = ?').run(row.id)
        this.sql('DELETE FROM prompts WHERE ref = ?').run(row.ref)
        this.sql('DELETE FROM sessions WHERE id = ?').run(row.id)
      }
    })
  }

  putHeads(rows: readonly IndexHead[]): void {
    if (rows.length > 0)
      this.transaction(() => rows.forEach(row => this.writeHead(row)))
  }

  putSummaries(rows: readonly IndexSummary[]): void {
    if (rows.length > 0)
      this.transaction(() => rows.forEach(row => this.writeSummary(row)))
  }

  search(query: string): string[] | undefined {
    // NUL and other control characters are not search text.
    const text = query.replace(/\p{Cc}/gu, ' ').trim()
    if (!text)
      return undefined
    try {
      if (Array.from(text).length < 3) {
        const pattern = `%${casefold(text).replace(/[\\%_]/g, match => `\\${match}`)}%`
        // Two plain `?` parameters: Node 22's node:sqlite cannot bind a positional argument to `?1`.
        const rows = this.sql(
          `SELECT ref FROM sessions WHERE casefold(title) LIKE ? ESCAPE '\\'
             OR ref IN (SELECT ref FROM prompts WHERE casefold(text) LIKE ? ESCAPE '\\')
           ORDER BY last_active_at DESC`,
        ).all(pattern, pattern) as { ref: unknown }[]
        return rows.map(row => String(row.ref))
      }
      // One quoted phrase: FTS5 operators in the query are plain text. `trigram` folds case itself.
      const phrase = `"${text.replaceAll('"', '""')}"`
      const rows = this.sql(
        `SELECT sessions.ref AS ref FROM search JOIN sessions ON sessions.id = search.rowid
         WHERE search MATCH ? ORDER BY sessions.last_active_at DESC`,
      ).all(phrase) as { ref: unknown }[]
      return rows.map(row => String(row.ref))
    }
    catch (error) {
      // Busy or locked: let the caller search in memory. Anything else is a query that matches nothing.
      return isBusy(error) ? undefined : []
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

  /** A NULL column is a capability the host does not record: it stays `undefined`, never 0. */
  private summaryOf(row: Record<string, unknown>): SessionSummary | undefined {
    if (readNumber(row.summary_version) !== this.version)
      return undefined
    const summary: SessionSummary = {}
    for (const [column, key] of SUMMARY_COLUMNS) {
      const value = readNumber(row[column])
      if (value !== undefined)
        summary[key] = value
    }
    if (typeof row.context_shape === 'string') {
      try {
        const parsed: unknown = JSON.parse(row.context_shape)
        if (Array.isArray(parsed) && parsed.every(item => typeof item === 'number'))
          summary.contextShape = parsed
      }
      catch {
        // A damaged shape is missing data.
      }
    }
    return summary
  }

  private writeHead(row: IndexHead): void {
    const stored = this.sql(`SELECT ${HEAD_SELECT} FROM sessions WHERE path = ?`).get(row.path) as Record<string, unknown> | undefined
    const next = { ...row, ...(row.firstPrompt ? { firstPrompt: clip(row.firstPrompt) } : {}) }
    const existing = stored ? headOf(stored) : undefined
    const sameKey = existing !== undefined && existing.size === row.size && existing.mtimeMs === row.mtimeMs && existing.ref === row.ref
    // Unchanged file and head: nothing to write. This is every row on a second launch.
    if (sameKey && [...HEAD_TEXT, ...HEAD_NUMBERS].every(([, key]) => existing[key] === next[key]))
      return
    this.sql(
      `INSERT INTO sessions (path, ref, host, size, mtime, session_id, title, cwd, first_prompt, started_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET
         ref = excluded.ref, host = excluded.host, size = excluded.size, mtime = excluded.mtime,
         session_id = excluded.session_id, title = excluded.title, cwd = excluded.cwd,
         first_prompt = excluded.first_prompt, started_at = excluded.started_at, last_active_at = excluded.last_active_at`,
    ).run(
      row.path,
      row.ref,
      row.host,
      row.size,
      row.mtimeMs,
      ...HEAD_TEXT.map(([, key]) => next[key] ?? null),
      ...HEAD_NUMBERS.map(([, key]) => next[key] ?? null),
    )
    if (sameKey) {
      this.rewriteSearch(row.path, next.title, this.promptsOf(row.ref))
      return
    }
    this.sql(
      `UPDATE sessions SET summary_version = NULL, ${SUMMARY_COLUMNS.map(([column]) => `${column} = NULL`).join(', ')},
       context_shape = NULL WHERE path = ?`,
    ).run(row.path)
    if (existing && existing.ref !== row.ref)
      this.sql('DELETE FROM prompts WHERE ref = ?').run(existing.ref)
    const prompts = next.firstPrompt ? [next.firstPrompt] : []
    this.replacePrompts(row.ref, prompts)
    this.rewriteSearch(row.path, next.title, prompts)
  }

  private writeSummary(row: IndexSummary): void {
    this.writeHead(row)
    const prompts = row.prompts.slice(0, PROMPT_LIMIT).map(clip).filter(text => text.length > 0)
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
    this.replacePrompts(row.ref, prompts)
    this.rewriteSearch(row.path, row.title, prompts)
  }

  private promptsOf(ref: string): string[] {
    const rows = this.sql('SELECT text FROM prompts WHERE ref = ? ORDER BY seq').all(ref) as { text: unknown }[]
    return rows.map(row => String(row.text))
  }

  private replacePrompts(ref: string, prompts: readonly string[]): void {
    this.sql('DELETE FROM prompts WHERE ref = ?').run(ref)
    const insert = this.sql('INSERT INTO prompts (ref, seq, text) VALUES (?, ?, ?)')
    prompts.forEach((text, seq) => insert.run(ref, seq, text))
  }

  /** One FTS row per session, keyed by `sessions.id`, so a rewrite is two lookups by rowid. */
  private rewriteSearch(path: string, title: string | undefined, prompts: readonly string[]): void {
    const session = this.sql('SELECT id FROM sessions WHERE path = ?').get(path) as { id: number | bigint } | undefined
    if (!session)
      return
    this.sql('DELETE FROM search WHERE rowid = ?').run(session.id)
    if (title || prompts.length > 0)
      this.sql('INSERT INTO search (rowid, title, prompts) VALUES (?, ?, ?)').run(session.id, title ?? '', prompts.join('\n'))
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      fn()
      this.db.exec('COMMIT')
    }
    catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

function headOf(row: Record<string, unknown>): IndexHead {
  const head: IndexHead = {
    ref: String(row.ref),
    host: String(row.host),
    path: String(row.path),
    size: Number(row.size),
    mtimeMs: Number(row.mtime),
  }
  for (const [column, key] of HEAD_TEXT) {
    const value = row[column]
    if (typeof value === 'string' && value !== '')
      head[key] = value
  }
  for (const [column, key] of HEAD_NUMBERS) {
    const value = readNumber(row[column])
    if (value !== undefined)
      head[key] = value
  }
  return head
}

/** SQLITE_BUSY and SQLITE_LOCKED, including their extended codes. */
function isBusy(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode
  return typeof code === 'number' && ((code & 0xff) === 5 || (code & 0xff) === 6)
}

function casefold(text: string): string {
  return text.toLowerCase()
}

function clip(text: string): string {
  return text.slice(0, PROMPT_CHARS)
}

function readNumber(value: unknown): number | undefined {
  if (value == null)
    return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
