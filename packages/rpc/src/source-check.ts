import type { SourcePointer, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { TraceIO } from '@rivus/agent-trace-kernel'
import { readOriginal } from '@rivus/agent-trace-kernel'

/** Size and mtime of one source file when its trace was loaded. */
export interface FileStamp {
  size: number
  mtimeMs: number
}

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const SHORT = 128

function fnv(hash: number, text: string): number {
  let out = hash
  for (let index = 0; index < text.length; index++) {
    out ^= text.charCodeAt(index)
    out = Math.imul(out, FNV_PRIME) >>> 0
  }
  return out
}

/**
 * Cheap identity of a host record: its top-level short scalar fields (type,
 * uuid, timestamp, …), hashed. Enough to tell that the bytes at a source
 * pointer are no longer the record that was loaded, without keeping originals.
 */
export function fingerprint(original: unknown): number {
  if (original == null || typeof original !== 'object' || Array.isArray(original)) {
    return 0
  }
  let hash = FNV_OFFSET
  for (const key of Object.keys(original).toSorted()) {
    const value = (original as Record<string, unknown>)[key]
    if (
      typeof value === 'number'
      || typeof value === 'boolean'
      || (typeof value === 'string' && value.length <= SHORT)
    ) {
      hash = fnv(fnv(hash, key), `=${String(value)};`)
    }
  }
  return hash
}

/** One fingerprint per event, in event order, taken while originals are still in memory. */
export function fingerprints(trace: Trace): Uint32Array {
  const out = new Uint32Array(trace.events.length)
  trace.events.forEach((event, index) => {
    out[index] = fingerprint(event.original)
  })
  return out
}

export async function stampFiles(trace: Trace, io: Pick<TraceIO, 'stat'>): Promise<Map<string, FileStamp>> {
  const stamps = new Map<string, FileStamp>()
  for (const file of new Set(trace.events.map(event => event.source.file))) {
    const info = await io.stat(file)
    if (info) {
      stamps.set(file, { size: info.size, mtimeMs: info.mtimeMs })
    }
  }
  return stamps
}

export type OriginalResult = { original: unknown } | { unavailable: string }

/**
 * Read the original back from its source pointer. When the file is unchanged
 * since the load, the bytes are trusted. When it changed (a live session keeps
 * appending, which moves mtime), the record must still be there: the file must
 * reach the pointer and the bytes must parse to a record with the same
 * fingerprint. Otherwise the original is unavailable, with the reason.
 */
export async function checkedOriginal(
  io: Pick<TraceIO, 'readBytes' | 'stat'>,
  event: TraceEvent,
  stamp: FileStamp | undefined,
  expected: number,
): Promise<OriginalResult> {
  const source: SourcePointer = event.source
  const now = await io.stat(source.file)
  if (!now) {
    return { unavailable: `${source.file} no longer exists` }
  }
  const changed = !stamp || now.size < stamp.size || now.mtimeMs !== stamp.mtimeMs
  if (!changed) {
    return { original: await readOriginal(io, source) }
  }
  if (now.size < source.offset + source.length) {
    return { unavailable: `${source.file} shrank since it was loaded; line ${source.line} is gone` }
  }
  let original: unknown
  try {
    original = await readOriginal(io, source)
  } catch {
    return { unavailable: `${source.file} changed since it was loaded; line ${source.line} is no longer a JSON record` }
  }
  if (fingerprint(original) !== expected) {
    return { unavailable: `${source.file} changed since it was loaded; line ${source.line} holds a different record` }
  }
  return { original }
}
