import type { TraceIO } from './io.ts'
import { describe, expect, it } from 'vitest'
import { readEdges } from './head-tail.ts'

function fakeIO(size: number, calls: { start: number, end: number }[]): TraceIO {
  return {
    async readText() {
      return ''
    },
    async readBytes(_path, range) {
      const start = range?.start ?? 0
      const end = range?.end ?? size
      calls.push({ start, end })
      return new Uint8Array(Math.max(0, end - start))
    },
    async list() {
      return []
    },
    async stat() {
      return { kind: 'file', size, mtimeMs: 0 }
    },
    async *lines() {},
  }
}

describe('readEdges', () => {
  it('reads both ends when the file is between 64 KB and 128 KB', async () => {
    const size = 90 * 1024
    const calls: { start: number, end: number }[] = []
    const edges = await readEdges(fakeIO(size, calls), 'session.jsonl')
    expect(edges?.whole).toBe(false)
    expect(calls).toEqual([
      { start: 0, end: 64 * 1024 },
      { start: size - 64 * 1024, end: size },
    ])
  })

  it('reads a file of at most 64 KB once', async () => {
    const calls: { start: number, end: number }[] = []
    const edges = await readEdges(fakeIO(100, calls), 'session.jsonl')
    expect(edges?.whole).toBe(true)
    expect(calls).toEqual([{ start: 0, end: 100 }])
  })
})
