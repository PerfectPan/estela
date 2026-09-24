import type { TraceIO } from './io.ts'

/** Discover reads at most this many bytes from each end of a file. */
export const EDGE_BYTES = 64 * 1024

export interface FileEdges {
  head: string
  tail: string
  size: number
  mtimeMs: number
  /** True when `head` holds the entire file. */
  whole: boolean
}

export async function readEdges(io: TraceIO, path: string, signal?: AbortSignal): Promise<FileEdges | null> {
  signal?.throwIfAborted()
  const info = await io.stat(path)
  if (info?.kind !== 'file')
    return null
  const decoder = new TextDecoder()
  if (info.size <= EDGE_BYTES) {
    const head = decoder.decode(await io.readBytes(path, { start: 0, end: info.size }))
    return { head, tail: '', size: info.size, mtimeMs: info.mtimeMs, whole: true }
  }
  // Always 64 KB from each end. A file between 64 KB and 128 KB overlaps; callers merge.
  const head = decoder.decode(await io.readBytes(path, { start: 0, end: EDGE_BYTES }))
  const tailStart = Math.max(0, info.size - EDGE_BYTES)
  const tail = decoder.decode(await io.readBytes(path, { start: tailStart, end: info.size }))
  return { head, tail, size: info.size, mtimeMs: info.mtimeMs, whole: false }
}

/** Complete JSONL lines from one edge. A partial line at the cut is dropped. */
export function edgeLines(text: string, edge: 'head' | 'tail', whole: boolean): string[] {
  if (!text)
    return []
  const parts = text.split('\n')
  if (!whole && edge === 'head' && !text.endsWith('\n'))
    parts.pop()
  if (!whole && edge === 'tail')
    parts.shift()
  return parts
    .map(line => line.endsWith('\r') ? line.slice(0, -1) : line)
    .filter(line => line.trim().length > 0)
}
