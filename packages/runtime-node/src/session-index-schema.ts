import { chmodSync, closeSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Bump when the table layout changes. A different `user_version` is deleted and rebuilt. */
const INDEX_LAYOUT_VERSION = 1
/**
 * node:sqlite is synchronous: a busy wait blocks the event loop. Under WAL, readers never
 * wait; a writer waits at most this long for another process's write lock, then gives up
 * (the caller skips that write; the index is a cache).
 */
const BUSY_TIMEOUT_MS = 200
/** SQLITE_CORRUPT and SQLITE_NOTADB. */
const BROKEN_CODES = new Set([11, 26])
/** A rebuild lock older than this is left over from a crashed process. */
const STALE_LOCK_MS = 10_000
const LOCK_WAIT_MS = 2_000

/**
 * Open the index at `file`: the directory is 0700 (also when it already exists) and the file
 * 0600 before SQLite touches it; SQLite gives `-wal` and `-shm` the database file's mode.
 * The schema is created inside `BEGIN IMMEDIATE`, so two processes opening a fresh cache at
 * once end with one schema. The file is rebuilt only when it is not a database, is corrupt, or
 * has another layout version (plan 3.4), and only by the process holding `<file>.lock`.
 * Throws for anything else (for example EACCES or a busy lock); the caller runs without the index.
 */
export function openDatabase(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  chmodSync(dirname(file), 0o700)
  closeSync(openSync(file, 'a', 0o600))
  chmodSync(file, 0o600)
  try {
    return prepare(file)
  }
  catch (error) {
    if (!isBroken(error) && !(error instanceof LayoutMismatch))
      throw error
  }
  return withRebuildLock(file, () => {
    // Another process may have rebuilt it while this one waited for the lock.
    try {
      return prepare(file)
    }
    catch (error) {
      if (!isBroken(error) && !(error instanceof LayoutMismatch))
        throw error
    }
    removeDatabase(file)
    closeSync(openSync(file, 'a', 0o600))
    return prepare(file)
  })
}

/** An exclusive-create lock file around delete-and-rebuild, so two processes never delete each other's fresh index. */
function withRebuildLock<T>(file: string, fn: () => T): T {
  const lock = `${file}.lock`
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      closeSync(openSync(lock, 'wx', 0o600))
      break
    }
    catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST')
        throw error
      const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0)
      if (age > STALE_LOCK_MS)
        rmSync(lock, { force: true })
      else if (Date.now() > deadline)
        // EEXIST means another process holds the lock; the timeout, not EEXIST, is the failure.
        // oxlint-disable-next-line preserve-caught-error
        throw new Error(`index rebuild is locked by another process (${lock})`)
      else
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
  try {
    return fn()
  }
  finally {
    rmSync(lock, { force: true })
  }
}

class LayoutMismatch extends Error {}

function isBroken(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode
  return typeof code === 'number' && BROKEN_CODES.has(code)
}

function prepare(file: string): DatabaseSync {
  const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS })
  try {
    if (readVersion(db) === INDEX_LAYOUT_VERSION)
      return withWal(db)
    db.exec('BEGIN IMMEDIATE')
    try {
      // Read again under the write lock: another process may have created the schema.
      const version = readVersion(db)
      if (version === 0 && isEmpty(db))
        createSchema(db)
      else if (version !== INDEX_LAYOUT_VERSION)
        throw new LayoutMismatch(`index layout ${version}, expected ${INDEX_LAYOUT_VERSION}`)
      db.exec('COMMIT')
    }
    catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return withWal(db)
  }
  catch (error) {
    db.close()
    throw error
  }
}

/** WAL: readers do not wait for a writer in another process. Kept as it is when another process is switching. */
function withWal(db: DatabaseSync): DatabaseSync {
  try {
    db.exec('PRAGMA journal_mode = WAL')
  }
  catch {
    // Busy: the next open tries again.
  }
  return db
}

function readVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number | bigint } | undefined
  return Number(row?.user_version ?? 0)
}

function isEmpty(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT count(*) AS n FROM sqlite_master').get() as { n: number | bigint }
  return Number(row.n) === 0
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      ref TEXT NOT NULL,
      host TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime REAL NOT NULL,
      session_id TEXT,
      title TEXT,
      cwd TEXT,
      first_prompt TEXT,
      started_at INTEGER,
      last_active_at INTEGER,
      summary_version INTEGER,
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
