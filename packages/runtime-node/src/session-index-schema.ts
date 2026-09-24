import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Bump when the table layout changes. A different `user_version` is deleted and rebuilt. */
export const INDEX_LAYOUT_VERSION = 1

/**
 * Open the index at `file`, creating the directory (0700) and the file (0600).
 * A file that fails to open, has another layout version, or lacks the tables
 * is deleted and rebuilt: the index is a cache (plan 3.4).
 */
export function openDatabase(file: string): DatabaseSync {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const first = tryOpen(file)
  if (first && schemaReady(first)) {
    chmodSync(file, 0o600)
    return first
  }
  first?.close()
  removeDatabase(file)
  const second = new DatabaseSync(file)
  createSchema(second)
  chmodSync(file, 0o600)
  return second
}

function tryOpen(file: string): DatabaseSync | undefined {
  try {
    return new DatabaseSync(file)
  }
  catch {
    return undefined
  }
}

function schemaReady(db: DatabaseSync): boolean {
  try {
    const version = readVersion(db)
    const tables = hasTables(db)
    if (version === INDEX_LAYOUT_VERSION && tables)
      return true
    if (version === 0 && !tables && isEmpty(db)) {
      createSchema(db)
      return true
    }
    return false
  }
  catch {
    // SQLITE_NOTADB and friends: rebuild.
    return false
  }
}

function readVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number | bigint } | undefined
  return Number(row?.user_version ?? 0)
}

function hasTables(db: DatabaseSync): boolean {
  const rows = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sessions', 'prompts', 'search')`,
  ).all() as { name: string }[]
  return rows.length === 3
}

function isEmpty(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT count(*) AS n FROM sqlite_master').get() as { n: number | bigint }
  return Number(row.n) === 0
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = DELETE;
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      ref TEXT NOT NULL,
      host TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      session_id TEXT,
      title TEXT,
      cwd TEXT,
      first_prompt TEXT,
      started_at INTEGER,
      last_active_at INTEGER,
      summary_ready INTEGER NOT NULL DEFAULT 0,
      turns INTEGER,
      requests INTEGER,
      tokens_in INTEGER,
      tokens_out INTEGER,
      duration_ms INTEGER,
      compactions INTEGER,
      subagents INTEGER,
      failed_tools INTEGER,
      context_shape TEXT
    );
    CREATE INDEX sessions_ref ON sessions (ref);
    CREATE TABLE prompts (
      ref TEXT NOT NULL,
      seq INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY (ref, seq)
    );
    -- One row per session; rowid = sessions.id. Prompts are joined with newlines.
    CREATE VIRTUAL TABLE search USING fts5(
      title,
      prompts,
      tokenize = 'trigram'
    );
    PRAGMA user_version = ${INDEX_LAYOUT_VERSION};
  `)
}

function removeDatabase(file: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm'])
    rmSync(`${file}${suffix}`, { force: true })
}
