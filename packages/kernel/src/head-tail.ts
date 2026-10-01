import type { TraceIO } from './io.ts'
import { asRecord } from './jsonl.ts'

/** Discover reads at most this many bytes from each end of a file. */
export const EDGE_BYTES = 64 * 1024

export interface FileEdges {
  /** Decoded head, for cheap `detect` checks. */
  head: string
  headBytes: Uint8Array
  tailBytes: Uint8Array
  /** File offset of `tailBytes[0]`. */
  tailStart: number
  size: number
  mtimeMs: number
  /** True when `headBytes` holds the entire file. */
  whole: boolean
}

const NEWLINE = 0x0a

/** Always 64 KB from each end; a file between 64 KB and 128 KB is read as two overlapping ranges. */
export async function readEdges(io: TraceIO, path: string, signal?: AbortSignal): Promise<FileEdges | null> {
  signal?.throwIfAborted()
  const info = await io.stat(path)
  if (info?.kind !== 'file') {
    return null
  }
  const whole = info.size <= EDGE_BYTES
  const headBytes = await io.readBytes(path, { start: 0, end: Math.min(info.size, EDGE_BYTES) })
  const tailStart = whole ? info.size : info.size - EDGE_BYTES
  const tailBytes = whole ? new Uint8Array(0) : await io.readBytes(path, { start: tailStart, end: info.size })
  const head = new TextDecoder().decode(headBytes)
  return { head, headBytes, tailBytes, tailStart, size: info.size, mtimeMs: info.mtimeMs, whole }
}

function splitLines(bytes: Uint8Array): string[] {
  return new TextDecoder()
    .decode(bytes)
    .split('\n')
    .map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter(line => line.trim().length > 0)
}

/**
 * Complete JSONL lines from both ends. The head keeps lines up to its last
 * newline. When the ranges overlap, the tail starts right after that newline,
 * so no line is lost; otherwise the tail drops its first, partial line.
 */
export function edgeLines(edges: FileEdges): string[] {
  if (edges.whole) {
    return splitLines(edges.headBytes)
  }
  const headCut = edges.headBytes.lastIndexOf(NEWLINE) + 1
  let tailFrom: number
  if (headCut > 0 && edges.tailStart <= headCut) {
    tailFrom = headCut - edges.tailStart
  } else {
    const first = edges.tailBytes.indexOf(NEWLINE)
    tailFrom = first < 0 ? edges.tailBytes.length : first + 1
  }
  return [...splitLines(edges.headBytes.subarray(0, headCut)), ...splitLines(edges.tailBytes.subarray(tailFrom))]
}

/** Parsed JSON object records from both ends. Lines that are not JSON objects are left out. */
export function edgeRecords(edges: FileEdges): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  for (const line of edgeLines(edges)) {
    try {
      const record = asRecord(JSON.parse(line) as unknown)
      if (record) {
        records.push(record)
      }
    } catch {
      // A line cut by the edge, or not JSON; the preview skips it.
    }
  }
  return records
}
