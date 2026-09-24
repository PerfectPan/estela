import type { TraceIO } from './io.ts'

export interface CountingIO extends TraceIO {
  bytesFor: (path: string) => number
  snapshot: () => ReadonlyMap<string, number>
}

/** Counts bytes returned by `readText`, `readBytes`, and `lines`. */
export function countingIO(inner: TraceIO): CountingIO {
  const counts = new Map<string, number>()
  const add = (path: string, bytes: number): void => {
    if (bytes <= 0)
      return
    counts.set(path, (counts.get(path) ?? 0) + bytes)
  }
  return {
    bytesFor(path) {
      return counts.get(path) ?? 0
    },
    snapshot() {
      return new Map(counts)
    },
    async readText(path) {
      const text = await inner.readText(path)
      add(path, new TextEncoder().encode(text).byteLength)
      return text
    },
    async readBytes(path, range) {
      const bytes = await inner.readBytes(path, range)
      add(path, bytes.byteLength)
      return bytes
    },
    list: dir => inner.list(dir),
    stat: path => inner.stat(path),
    async *lines(path, opts) {
      for await (const line of inner.lines(path, opts)) {
        add(path, line.length)
        yield line
      }
    },
  }
}
