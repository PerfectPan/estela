import { describe, expect, it } from 'vite-plus/test'
import type { TraceEvent } from '@rivus/agent-trace-schema'
import { fingerprint } from './source-check.ts'
import { checkedOriginal } from './source-check.ts'

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
    expect('unavailable' in result).toBe(true)
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
