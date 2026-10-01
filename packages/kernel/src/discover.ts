import type { SessionHead } from './host.ts'
import type { TraceIO } from './io.ts'
import { edgeRecords, readEdges } from './head-tail.ts'

export interface DiscoverPreview {
  title?: string
  cwd?: string
  startedAt?: number
  lastAt?: number
  firstPrompt?: string
  sessionId?: string
}

export async function* discoverSessions(
  host: string,
  root: string,
  io: TraceIO,
  opts: {
    signal?: AbortSignal
    onTotal?: (files: number) => void
    files: (io: TraceIO, root: string, signal?: AbortSignal) => Promise<string[]>
    preview: (records: Record<string, unknown>[]) => DiscoverPreview
    decorate?: (path: string, head: SessionHead, io: TraceIO) => Promise<void>
  },
): AsyncGenerator<SessionHead | { ref: { host: string; path: string }; error: string }> {
  if ((await io.stat(root)) == null) {
    yield { ref: { host, path: root }, error: `${host}: ${root} does not exist` }
    return
  }
  let paths: string[]
  try {
    paths = await opts.files(io, root, opts.signal)
  } catch (error) {
    yield { ref: { host, path: root }, error: error instanceof Error ? error.message : String(error) }
    return
  }
  opts.onTotal?.(paths.length)
  for (const path of paths) {
    opts.signal?.throwIfAborted()
    const edges = await readEdges(io, path, opts.signal)
    if (!edges) {
      continue
    }
    const preview = opts.preview(edgeRecords(edges))
    const head: SessionHead = {
      ref: { host, path, ...(preview.sessionId ? { sessionId: preview.sessionId } : {}) },
      lastActiveAt: preview.lastAt ?? edges.mtimeMs,
      sizeBytes: edges.size,
    }
    if (preview.title ?? preview.firstPrompt) {
      head.title = (preview.title ?? preview.firstPrompt)!.slice(0, 80)
    }
    if (preview.cwd) {
      head.cwd = preview.cwd
    }
    if (preview.startedAt !== undefined) {
      head.startedAt = preview.startedAt
    }
    if (preview.firstPrompt) {
      head.firstPrompt = preview.firstPrompt
    }
    if (opts.decorate) {
      await opts.decorate(path, head, io)
    }
    yield head
  }
}
