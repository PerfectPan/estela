import type { TraceIO } from './io.ts'

export interface ReadRange {
  start: number
  end: number
}

export interface CountingIO extends TraceIO {
  /** Bytes returned per path by `readText`, `readBytes`, and `lines`. */
  snapshot: () => ReadonlyMap<string, number>
  /** Byte ranges read per path. `readText` and `lines` count as one range each. */
  ranges: () => ReadonlyMap<string, readonly ReadRange[]>
}

/** Counts bytes and records the ranges read through `readText`, `readBytes`, and `lines`. */
export function countingIO(inner: TraceIO): CountingIO {
  const counts = new Map<string, number>()
  const reads = new Map<string, ReadRange[]>()
  const add = (path: string, range: ReadRange): void => {
    const bytes = range.end - range.start
    if (bytes <= 0) {
      return
    }
    counts.set(path, (counts.get(path) ?? 0) + bytes)
    reads.set(path, [...(reads.get(path) ?? []), range])
  }
  return {
    snapshot() {
      return new Map(counts)
    },
    ranges() {
      return new Map(reads)
    },
    async readText(path) {
      const text = await inner.readText(path)
      add(path, { start: 0, end: new TextEncoder().encode(text).byteLength })
      return text
    },
    async readBytes(path, range) {
      const bytes = await inner.readBytes(path, range)
      const start = range?.start ?? 0
      add(path, { start, end: start + bytes.byteLength })
      return bytes
    },
    list: dir => inner.list(dir),
    stat: path => inner.stat(path),
    async *lines(path, opts) {
      let start: number | undefined
      let end = 0
      try {
        for await (const line of inner.lines(path, opts)) {
          start ??= line.offset
          end = line.offset + line.length
          yield line
        }
      } finally {
        if (start !== undefined) {
          add(path, { start, end })
        }
      }
    },
  }
}
