import { chmodSync, closeSync, existsSync, fchmodSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Bump when the table layout changes. A different `user_version` is deleted and rebuilt. */
const INDEX_LAYOUT_VERSION = 2
/**
 * node:sqlite is synchronous: a busy wait blocks the event loop. Under WAL, readers never
 * wait; a writer waits at most this long for another process's write lock, then gives up
 * (the caller skips that write; the index is a cache).
 */
const BUSY_TIMEOUT_MS = 200
/** SQLITE_CORRUPT and SQLITE_NOTADB. */
const BROKEN_CODES = new Set([11, 26])
/** SQLITE_BUSY and SQLITE_LOCKED: another process holds the write lock; open again. */
const BUSY_CODES = new Set([5, 6])
/** A rebuild lock older than this is left over from a crashed process. */
const STALE_LOCK_MS = 10_000
/** How long an open waits for another process's rebuild or write lock before it gives up. */
const LOCK_WAIT_MS = 5_000

/**
 * Create `file` if missing and make it 0600 through the open descriptor: a path-based chmod can
 * race with another process deleting the file for a rebuild.
 */
function touchPrivate(file: string): void {
  const fd = openSync(file, 'a', 0o600)
  try {
    fchmodSync(fd, 0o600)
  } finally {
    closeSync(fd)
  }
}

class LayoutMismatch extends Error {}

function errcode(error: unknown): unknown {
  return (error as { errcode?: unknown } | null)?.errcode
}

function isBroken(error: unknown): boolean {
  const code = errcode(error)
  return typeof code === 'number' && BROKEN_CODES.has(code)
}

function isBusy(error: unknown): boolean {
  const code = errcode(error)
  return typeof code === 'number' && BUSY_CODES.has(code)
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
      agent TEXT NOT NULL,
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

/** WAL: readers do not wait for a writer in another process. Kept as it is when another process is switching. */
function withWal(db: DatabaseSync): DatabaseSync {
  try {
    db.exec('PRAGMA journal_mode = WAL')
  } catch {
    // Busy: the next open tries again.
  }
  return db
}

/**
 * Side files first, the database last: a process that opens the path after the database is gone
 * creates its own `-wal` and `-shm`, and they must not be deleted under it.
 */
function removeDatabase(file: string): void {
  for (const suffix of ['-wal', '-shm', '-journal', '']) {
    rmSync(`${file}${suffix}`, { force: true })
  }
}

function prepare(file: string): DatabaseSync {
  const db = new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS })
  try {
    if (readVersion(db) === INDEX_LAYOUT_VERSION) {
      return withWal(db)
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      // Read again under the write lock: another process may have created the schema.
      const version = readVersion(db)
      if (version === 0 && isEmpty(db)) {
        createSchema(db)
      } else if (version !== INDEX_LAYOUT_VERSION) {
        throw new LayoutMismatch(`index layout ${version}, expected ${INDEX_LAYOUT_VERSION}`)
      }
      db.exec('COMMIT')
    } catch (error) {
      // SQLite may have rolled back already (a busy or I/O error); keep the first error.
      if (db.isTransaction) {
        db.exec('ROLLBACK')
      }
      throw error
    }
    return withWal(db)
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Delete and rebuild under an exclusive-create lock file, so two processes never delete each
 * other's fresh index. `undefined` when another process holds the lock: the caller waits and
 * opens again. A lock older than `STALE_LOCK_MS` is left over from a crashed process.
 */
function rebuildUnderLock(file: string, lock: string): DatabaseSync | undefined {
  try {
    closeSync(openSync(lock, 'wx', 0o600))
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'EEXIST') {
      throw error
    }
    const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now())
    if (age > STALE_LOCK_MS) {
      rmSync(lock, { force: true })
    }
    return undefined
  }
  try {
    // Another process may have rebuilt it between this one's failed open and the lock.
    try {
      return prepare(file)
    } catch (error) {
      if (!isBroken(error) && !(error instanceof LayoutMismatch)) {
        throw error
      }
    }
    removeDatabase(file)
    touchPrivate(file)
    return prepare(file)
  } finally {
    rmSync(lock, { force: true })
  }
}

/**
 * Open the index at `file`: the directory is 0700 (also when it already exists) and the file
 * 0600 before SQLite touches it; SQLite gives `-wal` and `-shm` the database file's mode.
 * The schema is created inside `BEGIN IMMEDIATE`, so two processes opening a fresh cache at
 * once end with one schema. The file is rebuilt only when it is not a database, is corrupt, or
 * has another layout version (plan 3.4), and only by the process holding `<file>.lock`; the
 * others wait for that lock to go and open again. Throws for anything else (for example EACCES),
 * or after `LOCK_WAIT_MS`; the caller runs without the index.
 */
export function openDatabase(file: string): DatabaseSync {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  chmodSync(dirname(file), 0o700)
  touchPrivate(file)
  const lock = `${file}.lock`
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    let failure: unknown
    try {
      return prepare(file)
    } catch (error) {
      failure = error
    }
    const rebuilding = existsSync(lock)
    if (!rebuilding && (isBroken(failure) || failure instanceof LayoutMismatch)) {
      const rebuilt = rebuildUnderLock(file, lock)
      if (rebuilt) {
        return rebuilt
      }
    } else if (!rebuilding && !isBusy(failure)) {
      throw failure
    }
    // Another process holds the rebuild lock or the write lock: open again once it lets go.
    if (Date.now() > deadline) {
      throw rebuilding ? new Error(`index rebuild is locked by another process (${lock})`) : failure
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  }
}
