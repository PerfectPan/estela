import { describe, expect, it } from 'vite-plus/test'
import { isBroken, isBusy, isTransient, sqliteErrcode } from './session-index-schema.ts'

/** The shape node:sqlite gives its errors: the message plus the (possibly extended) result code. */
function sqliteError(errcode: number, message = 'database is locked'): Error {
  return Object.assign(new Error(message), { errcode })
}

describe('session index result codes', () => {
  it('reads the result code off a node:sqlite error and nothing else', () => {
    expect(sqliteErrcode(sqliteError(5))).toBe(5)
    expect(sqliteErrcode(sqliteError(261))).toBe(261)
    expect(sqliteErrcode(new Error('not from SQLite'))).toBeUndefined()
    expect(sqliteErrcode(undefined)).toBeUndefined()
  })

  it('treats the extended busy codes as busy, so an open retries instead of giving up', () => {
    // SQLITE_BUSY, SQLITE_LOCKED, then SQLITE_BUSY_RECOVERY (a reader during another process's
    // WAL conversion or recovery), SQLITE_BUSY_SNAPSHOT, SQLITE_BUSY_TIMEOUT, SQLITE_LOCKED_SHAREDCACHE.
    for (const code of [5, 6, 261, 517, 773, 262]) {
      expect({ code, busy: isBusy(sqliteError(code)) }).toEqual({ code, busy: true })
    }
    for (const code of [11, 26, 267, 8, 14]) {
      expect({ code, busy: isBusy(sqliteError(code, 'other')) }).toEqual({ code, busy: false })
    }
    expect(isBusy(new Error('database is locked'))).toBe(false)
    expect(isBusy(undefined)).toBe(false)
  })

  it('treats I/O errors as transient, so a delete under a concurrent rebuild retries', () => {
    // SQLITE_IOERR and SQLITE_IOERR_WRITE (a reader of a file another process deleted).
    expect(isTransient(sqliteError(10, 'disk I/O error'))).toBe(true)
    expect(isTransient(sqliteError(5898, 'disk I/O error'))).toBe(true)
    // The busy codes stay transient, and a real failure does not.
    expect(isTransient(sqliteError(261))).toBe(true)
    for (const code of [11, 26, 8, 13, 14]) {
      expect({ code, transient: isTransient(sqliteError(code, 'other')) }).toEqual({ code, transient: false })
    }
    expect(isTransient(new Error('disk I/O error'))).toBe(false)
  })

  it('treats the extended corrupt codes as broken, so the file is rebuilt', () => {
    // SQLITE_CORRUPT, SQLITE_NOTADB, then SQLITE_CORRUPT_VTAB, SQLITE_CORRUPT_SEQUENCE, SQLITE_CORRUPT_INDEX.
    for (const code of [11, 26, 267, 523, 779]) {
      expect({ code, broken: isBroken(sqliteError(code, 'malformed')) }).toEqual({ code, broken: true })
    }
    for (const code of [5, 6, 261, 8, 14]) {
      expect({ code, broken: isBroken(sqliteError(code)) }).toEqual({ code, broken: false })
    }
    expect(isBroken(new Error('file is not a database'))).toBe(false)
  })
})
