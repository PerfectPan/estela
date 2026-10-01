import type { SourcePointer } from '@rivus/agent-trace-schema'
import type { TraceIO } from './io.ts'

export interface SourcedRecord {
  file: string
  offset: number
  length: number
  line: number
  value: unknown
}

export function sourceOf(record: SourcedRecord): SourcePointer {
  return {
    file: record.file,
    offset: record.offset,
    length: record.length,
    line: record.line,
  }
}

/** Read a host record back from its source pointer (`end` = `offset + length`) and parse it. */
export async function readOriginal(io: Pick<TraceIO, 'readBytes'>, source: SourcePointer): Promise<unknown> {
  const bytes = await io.readBytes(source.file, { start: source.offset, end: source.offset + source.length })
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${source.file}:${source.line}: the record at this source pointer is not JSON`)
  }
}

export function generationError(host: string, file: string, line: number): Error {
  return new Error(`${host}: ${file}:${line}: unknown format generation`)
}

export interface ReadProgress {
  total: number
  onProgress?: (total: number) => void
}

export function readProgress(onProgress?: (total: number) => void): ReadProgress {
  return { total: 0, onProgress }
}

/** `io.readText` that adds the bytes read to `progress`. */
export async function readTextCounted(io: TraceIO, path: string, progress?: ReadProgress): Promise<string> {
  const text = await io.readText(path)
  if (progress) {
    progress.total += new TextEncoder().encode(text).byteLength
    progress.onProgress?.(progress.total)
  }
  return text
}

export async function readJsonlRecords(
  file: string,
  io: TraceIO,
  host: string,
  opts?: { signal?: AbortSignal; progress?: ReadProgress },
): Promise<SourcedRecord[]> {
  const records: SourcedRecord[] = []
  for await (const line of io.lines(file, { signal: opts?.signal })) {
    opts?.signal?.throwIfAborted()
    if (opts?.progress) {
      opts.progress.total += line.length
      opts.progress.onProgress?.(opts.progress.total)
    }
    if (!line.text.trim()) {
      continue
    }
    let value: unknown
    try {
      value = JSON.parse(line.text) as unknown
    } catch {
      throw new Error(`${host}: ${file}:${line.line}: invalid JSON`)
    }
    records.push({
      file,
      offset: line.offset,
      length: line.length,
      line: line.line,
      value,
    })
  }
  return records
}
