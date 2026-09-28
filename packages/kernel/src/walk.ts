import type { TraceIO } from './io.ts'
import { joinPath } from './path.ts'

export async function walkFiles(
  io: TraceIO,
  dir: string,
  opts: {
    match: (name: string) => boolean
    skipDir?: (name: string) => boolean
    maxDepth: number
    signal?: AbortSignal
  },
): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string, depth: number): Promise<void> {
    opts.signal?.throwIfAborted()
    const entries = await io.list(current)
    for (const entry of entries) {
      if (opts.skipDir?.(entry.name))
        continue
      const path = joinPath(current, entry.name)
      if (entry.kind === 'file' && opts.match(entry.name))
        out.push(path)
      else if (entry.kind === 'dir' && depth < opts.maxDepth)
        await walk(path, depth + 1)
    }
  }
  await walk(dir, 0)
  return out
}
