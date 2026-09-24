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

export function generationError(host: string, file: string, line: number): Error {
  return new Error(`${host}: ${file}:${line}: unknown format generation`)
}

export async function readJsonlRecords(
  file: string,
  io: TraceIO,
  host: string,
  opts?: { signal?: AbortSignal, onBytes?: (bytes: number) => void },
): Promise<SourcedRecord[]> {
  const records: SourcedRecord[] = []
  for await (const line of io.lines(file, { signal: opts?.signal })) {
    opts?.signal?.throwIfAborted()
    opts?.onBytes?.(line.length)
    if (!line.text.trim())
      continue
    let value: unknown
    try {
      value = JSON.parse(line.text) as unknown
    }
    catch {
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
