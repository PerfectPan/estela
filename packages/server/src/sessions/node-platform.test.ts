import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vite-plus/test'
import { createShellPlatform, decompressZstdBounded, hardenPlatform } from './node-platform.ts'

describe('decompressZstdBounded', () => {
  it('decompresses valid single and concatenated zstd frames within the limit', () => {
    const first = Buffer.from('{"a":1}\n')
    const second = Buffer.from('{"b":2}\n')
    const combined = Buffer.concat([zstdCompressSync(first), zstdCompressSync(second)])
    expect(decompressZstdBounded(combined, 1024)).toEqual(Buffer.concat([first, second]))
  })

  it('rejects a zstd decompression bomb before allocating the full output', () => {
    const bomb = zstdCompressSync(Buffer.alloc(10 * 1024 * 1024))
    expect(bomb.byteLength).toBeLessThan(8192)
    expect(() => decompressZstdBounded(bomb, 1024 * 1024)).toThrow(
      'compressed session exceeds the 1 MB decompression limit',
    )
  })

  it('rejects concatenated zstd frames whose cumulative output exceeds the limit', () => {
    const chunk = zstdCompressSync(Buffer.alloc(600, 0x41))
    const combined = Buffer.concat([chunk, chunk])
    expect(() => decompressZstdBounded(combined, 1024)).toThrow(
      'compressed session exceeds the 1024-byte decompression limit',
    )
  })
})

describe('hardenPlatform', () => {
  it('enforces trusted_schema = OFF and cell_size_check = ON on real read-only sqlite opens only', () => {
    const dir = mkdtempSync(join(tmpdir(), 'at-sqlite-harden-'))
    try {
      const dbPath = join(dir, 'session.sqlite')
      const platform = createShellPlatform({ home: dir, env: {} })
      expect(hardenPlatform(platform)).toBe(platform)

      const rw = platform.sqlite!.open(dbPath)
      rw.exec('CREATE TABLE t (x INTEGER)')
      rw.close()

      const ro = platform.sqlite!.open(dbPath, { readonly: true })
      try {
        expect(ro.prepare('PRAGMA trusted_schema').get()).toEqual({ trusted_schema: 0 })
        expect(ro.prepare('PRAGMA cell_size_check').get()).toEqual({ cell_size_check: 1 })
      } finally {
        ro.close()
      }

      const rwReopened = platform.sqlite!.open(dbPath, { readonly: false })
      try {
        expect(rwReopened.prepare('PRAGMA trusted_schema').get()).toEqual({ trusted_schema: 1 })
        expect(rwReopened.prepare('PRAGMA cell_size_check').get()).toEqual({ cell_size_check: 0 })
      } finally {
        rwReopened.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
