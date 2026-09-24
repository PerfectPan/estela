import type { SessionHead } from './host.ts'
import type { TraceIO } from './io.ts'
import { EDGE_BYTES, edgeLines, readEdges, type FileEdges } from './head-tail.ts'

/** Head lines plus the non-overlapping tail. A partial line at each cut is dropped. */
export function edgeRecords(edges: FileEdges): string[] {
  const head = edgeLines(edges.head, 'head', edges.whole)
  if (edges.whole || !edges.tail)
    return head
  if (edges.size >= EDGE_BYTES * 2)
    return [...head, ...edgeLines(edges.tail, 'tail', false)]
  const overlap = EDGE_BYTES * 2 - edges.size
  const tailBytes = new TextEncoder().encode(edges.tail)
  const rest = new TextDecoder().decode(tailBytes.subarray(Math.min(overlap, tailBytes.length)))
  return [...head, ...edgeLines(rest, 'tail', false)]
}

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
    files: (io: TraceIO, root: string, signal?: AbortSignal) => Promise<string[]>
    preview: (lines: string[]) => DiscoverPreview
    decorate?: (path: string, head: SessionHead, io: TraceIO) => Promise<void>
  },
): AsyncGenerator<SessionHead | { ref: { host: string, path: string }, error: string }> {
  if ((await io.stat(root)) == null) {
    yield { ref: { host, path: root }, error: `${host}: ${root} does not exist` }
    return
  }
  let paths: string[]
  try {
    paths = await opts.files(io, root, opts.signal)
  }
  catch (error) {
    yield { ref: { host, path: root }, error: error instanceof Error ? error.message : String(error) }
    return
  }
  for (const path of paths) {
    opts.signal?.throwIfAborted()
    const edges = await readEdges(io, path, opts.signal)
    if (!edges)
      continue
    const preview = opts.preview(edgeRecords(edges))
    const head: SessionHead = {
      ref: { host, path, ...(preview.sessionId ? { sessionId: preview.sessionId } : {}) },
      lastActiveAt: preview.lastAt ?? edges.mtimeMs,
      sizeBytes: edges.size,
    }
    if (preview.title ?? preview.firstPrompt)
      head.title = (preview.title ?? preview.firstPrompt)!.slice(0, 80)
    if (preview.cwd)
      head.cwd = preview.cwd
    if (preview.startedAt !== undefined)
      head.startedAt = preview.startedAt
    if (preview.firstPrompt)
      head.firstPrompt = preview.firstPrompt
    if (opts.decorate)
      await opts.decorate(path, head, io)
    yield head
  }
}
