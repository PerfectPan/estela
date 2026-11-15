import { zstdCompressSync } from 'node:zlib'
import type { Platform } from '@rivus/agent-kit/platform'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ShellPlatform } from './load-session.ts'
import { decompressZstdBounded, hardenPlatform } from './node-platform.ts'

type SqliteDb = ReturnType<NonNullable<Platform['sqlite']>['open']>

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
  it('enforces trusted_schema = OFF and cell_size_check = ON on read-only sqlite opens only', () => {
    const calls: string[] = []
    const base = createNodePlatform({ home: '/u/me', env: {} })
    const mockPlatform: ShellPlatform = {
      ...base,
      sqlite: {
        open() {
          return {
            exec(sql) {
              calls.push(sql)
            },
            prepare: vi.fn<SqliteDb['prepare']>(),
            close: vi.fn<SqliteDb['close']>(),
          }
        },
      },
    }
    const hardened = hardenPlatform(mockPlatform)
    expect(hardenPlatform(hardened)).toBe(hardened)

    hardened.sqlite!.open('/tmp/a.db', { readonly: true })
    expect(calls).toEqual(['PRAGMA trusted_schema = OFF; PRAGMA cell_size_check = ON;'])

    calls.length = 0
    hardened.sqlite!.open('/tmp/a.db', { readonly: false })
    hardened.sqlite!.open('/tmp/a.db')
    expect(calls).toEqual([])
  })
})
