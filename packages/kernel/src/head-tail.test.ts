import type { TraceIO } from './io.ts'
import { describe, expect, it } from 'vitest'
import { edgeRecords, readEdges } from './head-tail.ts'

function bytesIO(file: Uint8Array, calls: { start: number, end: number }[] = []): TraceIO {
  return {
    async readText() {
      return new TextDecoder().decode(file)
    },
    async readBytes(_path, range) {
      const start = range?.start ?? 0
      const end = range?.end ?? file.length
      calls.push({ start, end })
      return file.slice(start, end)
    },
    async list() {
      return []
    },
    async stat() {
      return { kind: 'file', size: file.length, mtimeMs: 0 }
    },
    async *lines() {},
  }
}

function paddedLine(n: number, bytes: number): string {
  const base = `{"n":${n},"pad":""}`
  return `{"n":${n},"pad":"${'x'.repeat(bytes - 1 - base.length)}"}`
}

/** JSONL lines of `{"n":i,"pad":"…"}` up to `size` bytes; one line ends exactly at byte `boundary`. */
function jsonl(size: number, boundary: number): { file: Uint8Array, count: number } {
  const lines: string[] = []
  let length = 0
  for (; length + 1000 <= boundary; length += 1000)
    lines.push(paddedLine(lines.length, 1000))
  lines.push(paddedLine(lines.length, boundary - length))
  for (length = boundary; length + 1000 <= size; length += 1000)
    lines.push(paddedLine(lines.length, 1000))
  return { file: new TextEncoder().encode(`${lines.join('\n')}\n`), count: lines.length }
}

describe('readEdges', () => {
  it('reads 64 KB from each end when the file is between 64 KB and 128 KB', async () => {
    const { file } = jsonl(90 * 1024, 64 * 1024)
    const calls: { start: number, end: number }[] = []
    const edges = await readEdges(bytesIO(file, calls), 'session.jsonl')
    expect(edges?.whole).toBe(false)
    expect(calls).toEqual([
      { start: 0, end: 64 * 1024 },
      { start: file.length - 64 * 1024, end: file.length },
    ])
  })

  it('keeps every line of a 90 KB file whose line boundary is exactly at 64 KB', async () => {
    const { file, count } = jsonl(90 * 1024, 64 * 1024)
    expect(new TextDecoder().decode(file.subarray(0, 64 * 1024)).endsWith('\n')).toBe(true)
    const edges = await readEdges(bytesIO(file), 'session.jsonl')
    expect(edgeRecords(edges!).map(record => record.n)).toEqual(Array.from({ length: count }, (_, index) => index))
  })

  it('reads a file of at most 64 KB once', async () => {
    const calls: { start: number, end: number }[] = []
    const edges = await readEdges(bytesIO(new TextEncoder().encode('{"n":0}\n'), calls), 'session.jsonl')
    expect(edges?.whole).toBe(true)
    expect(calls).toEqual([{ start: 0, end: 8 }])
    expect(edgeRecords(edges!)).toEqual([{ n: 0 }])
  })
})
