import type { TraceIO } from './io.ts'

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value
}

function childrenOf(dir: string, files: Map<string, Uint8Array>): { name: string, kind: 'file' | 'dir' }[] {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`
  const names = new Map<string, 'file' | 'dir'>()
  for (const path of files.keys()) {
    if (!path.startsWith(prefix))
      continue
    const rest = path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0)
      names.set(rest, 'file')
    else
      names.set(rest.slice(0, slash), 'dir')
  }
  return [...names.entries()].map(([name, kind]) => ({ name, kind }))
}

/** In-memory `TraceIO` for fixtures. Paths use `/`. */
export function memoryIO(input: Record<string, string | Uint8Array>): TraceIO {
  const files = new Map<string, Uint8Array>()
  for (const [path, value] of Object.entries(input))
    files.set(path, toBytes(value))

  function bytesOf(path: string): Uint8Array {
    const bytes = files.get(path)
    if (!bytes)
      throw new Error(`${path} does not exist`)
    return bytes
  }

  return {
    async readText(path) {
      return new TextDecoder().decode(bytesOf(path))
    },
    async readBytes(path, range) {
      const bytes = bytesOf(path)
      if (!range)
        return bytes.slice()
      const start = Math.max(0, range.start)
      const end = Math.min(bytes.length, range.end)
      if (end <= start)
        return new Uint8Array()
      return bytes.slice(start, end)
    },
    async list(dir) {
      return childrenOf(dir, files)
    },
    async stat(path) {
      const bytes = files.get(path)
      if (bytes)
        return { kind: 'file', size: bytes.length, mtimeMs: 0 }
      if (childrenOf(path, files).length > 0)
        return { kind: 'dir', size: 0, mtimeMs: 0 }
      return null
    },
    async *lines(path, opts) {
      const data = bytesOf(path)
      const decoder = new TextDecoder()
      let offset = 0
      let line = 1
      let start = 0
      for (let index = 0; index <= data.length; index++) {
        opts?.signal?.throwIfAborted()
        const atEnd = index === data.length
        if (!atEnd && data[index] !== 0x0a)
          continue
        if (atEnd && start === data.length)
          break
        let end = index
        let newline = atEnd ? 0 : 1
        if (end > start && data[end - 1] === 0x0d) {
          end -= 1
          newline = 2
        }
        const slice = data.subarray(start, end)
        yield { text: decoder.decode(slice), offset, length: slice.byteLength, line }
        offset += slice.byteLength + newline
        line += 1
        start = index + 1
        if (atEnd)
          break
      }
    },
  }
}
