import type { TraceIO } from '@rivus/agent-trace-kernel'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'

export function homeDir(): string {
  return homedir()
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error != null && 'code' in error && error.code === 'ENOENT'
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

  lines(path, opts) {
    return readLines(path, opts)
  },
}

async function* readLines(path: string, opts?: { signal?: AbortSignal }): AsyncIterable<{ text: string, offset: number, length: number, line: number }> {
  const handle = await open(path, 'r')
  const decoder = new TextDecoder('utf-8')
  const chunk = Buffer.alloc(64 * 1024)
  let pending = Buffer.alloc(0)
  let base = 0
  let line = 1
  try {
    while (true) {
      opts?.signal?.throwIfAborted()
      const { bytesRead } = await handle.read(chunk, 0, chunk.length)
      if (bytesRead === 0)
        break
      pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)])
      let start = 0
      while (start < pending.length) {
        const nl = pending.indexOf(0x0a, start)
        if (nl < 0)
          break
        let end = nl
        if (end > start && pending[end - 1] === 0x0d)
          end -= 1
        const slice = pending.subarray(start, end)
        yield {
          text: decoder.decode(slice),
          offset: base + start,
          length: end - start,
          line,
        }
        line += 1
        start = nl + 1
      }
      base += start
      pending = Buffer.from(pending.subarray(start))
    }
    if (pending.length > 0) {
      yield {
        text: decoder.decode(pending),
        offset: base,
        length: pending.length,
        line,
      }
    }
  }
  finally {
    await handle.close()
  }
}
