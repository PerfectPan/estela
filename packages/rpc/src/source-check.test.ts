import { describe, expect, it } from 'vite-plus/test'
import type { TraceEvent } from '@rivus/estela-schema'
import { fingerprint, checkedOriginal } from './source-check.ts'

const fs = {
  stat: async () => ({ kind: 'file', size: 0, mtimeMs: 1 }),
  // The resolver reads database rows; a raw range read would fail this test.
  read: () => {
    throw new Error('raw read should not run')
  },
}

const original = { type: 'text', text: 'from a row' }

const event = {
  id: 'part:1',
  seq: 0,
  ts: 1,
  kind: 'user',
  payload: { text: 'from a row' },
  source: {
    file: '/data/opencode.db',
    offset: 0,
    length: 0,
    line: 1,
    sqlite: { table: 'part', column: 'data', rowid: 1 },
  },
} satisfies TraceEvent

describe('checkedOriginal', () => {
  it.each(['sqlite', 'codec'] as const)(
    'reports a missing %s platform resolver without attempting a raw read',
    async kind => {
      const source =
        kind === 'sqlite' ? event.source : { file: 'f.zst', offset: 50, length: 10, line: 1, codec: 'zstd' as const }
      const result = await checkedOriginal(fs, undefined, { ...event, source }, undefined, 0)
      expect(result).toEqual({ unavailable: expect.stringContaining('needs a platform reader') })
    },
  )

  it.each([undefined, { size: 0, mtimeMs: 1 }])(
    'resolves decompressed offsets even when the compressed file is shorter (stamp %j)',
    async stamp => {
      const compressedEvent = {
        ...event,
        source: { file: '/data/session.zst', offset: 1000, length: 200, line: 2, codec: 'zstd' as const },
      }
      let calls = 0
      const result = await checkedOriginal(
        fs,
        async source => {
          calls += 1
          expect(source.codec).toBe('zstd')
          return original
        },
        compressedEvent,
        stamp,
        fingerprint(original),
      )
      expect(result).toEqual({ original })
      expect(calls).toBe(1)
    },
  )

  it('reads a SQLite source through the injected resolver', async () => {
    const result = await checkedOriginal(
      fs,
      async source => {
        expect(source.sqlite).toEqual({ table: 'part', column: 'data', rowid: 1 })
        return original
      },
      event,
      undefined,
      fingerprint(original, true),
    )
    expect(result).toEqual({ original })
  })

  it('reports a resolver failure as unavailable instead of reading raw bytes', async () => {
    const result = await checkedOriginal(
      fs,
      async () => {
        throw new Error('row is gone')
      },
      event,
      undefined,
      fingerprint(original, true),
    )
    expect(result).toEqual({ unavailable: expect.stringContaining('row is gone') })
  })

  it('rejects nested and long SQLite row changes even when the main file stamp is unchanged', async () => {
    const loaded = { type: 'text', content: { text: 'a'.repeat(300) } }
    const result = await checkedOriginal(
      fs,
      async () => ({ ...loaded, content: { text: 'b'.repeat(300) } }),
      event,
      { size: 0, mtimeMs: 1 },
      fingerprint(loaded, true),
    )
    expect(result).toEqual({ unavailable: expect.stringContaining('holds a different record') })
  })
})
