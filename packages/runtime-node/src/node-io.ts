import type { TraceIO } from '@rivus/agent-trace-kernel'
import { open, readFile, readdir, stat } from 'node:fs/promises'

export { homedir as homeDir } from 'node:os'

const CHUNK = 64 * 1024

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error != null && 'code' in error && error.code === 'ENOENT'
}

async function* readLines(path: string, opts?: { signal?: AbortSignal }): AsyncIterable<{ text: string, offset: number, length: number, line: number }> {
  const handle = await open(path, 'r')
  const decoder = new TextDecoder('utf-8')
  const chunk = Buffer.alloc(CHUNK)
  const pending: Buffer[] = []
  let pendingBytes = 0
  let lineStart = 0
  let line = 1
  try {
    while (true) {
      opts?.signal?.throwIfAborted()
      const { bytesRead } = await handle.read(chunk, 0, chunk.length)
      if (bytesRead === 0)
        break
      let from = 0
      while (from < bytesRead) {
        const nl = chunk.indexOf(0x0a, from)
        if (nl < 0 || nl >= bytesRead) {
          const rest = Buffer.alloc(bytesRead - from)
          chunk.copy(rest, 0, from, bytesRead)
          pending.push(rest)
          pendingBytes += rest.length
          break
        }
        let end = nl
        let newline = 1
        if (end > from && chunk[end - 1] === 0x0d) {
          end -= 1
          newline = 2
        }
        else if (end === from && pendingBytes > 0) {
          const last = pending[pending.length - 1]!
          if (last.length > 0 && last[last.length - 1] === 0x0d) {
            pending[pending.length - 1] = last.subarray(0, -1)
            pendingBytes -= 1
            newline = 2
          }
        }
        const tail = chunk.subarray(from, end)
        const text = pending.length === 0
          ? tail
          : Buffer.concat(tail.length > 0 ? [...pending, tail] : pending, pendingBytes + tail.length)
        yield { text: decoder.decode(text), offset: lineStart, length: text.length, line }
        line += 1
        lineStart += text.length + newline
        pending.length = 0
        pendingBytes = 0
        from = nl + 1
      }
    }
    if (pendingBytes > 0) {
      const text = Buffer.concat(pending, pendingBytes)
      yield { text: decoder.decode(text), offset: lineStart, length: text.length, line }
    }
  }
  finally {
    await handle.close()
  }
}

export const nodeIO: TraceIO = {
  async readText(path) {
    return readFile(path, 'utf8')
  },

  async readBytes(path, range) {
    if (!range)
      return new Uint8Array(await readFile(path))
    const length = range.end - range.start
    if (length <= 0)
      return new Uint8Array()
    const handle = await open(path, 'r')
    try {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buf, 0, length, range.start)
      return new Uint8Array(buf.subarray(0, bytesRead))
    }
    finally {
      await handle.close()
    }
  },

  async list(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.map(entry => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' as const : 'file' as const,
    }))
  },

  async stat(path) {
    try {
      const info = await stat(path)
      return {
        kind: info.isDirectory() ? 'dir' as const : 'file' as const,
        size: info.size,
        mtimeMs: info.mtimeMs,
      }
    }
    catch (error) {
      if (isEnoent(error))
        return null
      throw error
    }
  },

  lines: readLines,
}
