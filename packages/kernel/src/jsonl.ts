import type { TraceIO } from './io.ts'

export function parseJsonl(text: string): unknown[] {
  const rows: unknown[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed)
      continue
    rows.push(JSON.parse(trimmed) as unknown)
  }
  return rows
}

export async function readJsonl(path: string, io: TraceIO): Promise<unknown[]> {
  return parseJsonl(await io.readText(path))
}

export function splitSessionRef(path: string): { file: string, sessionId?: string } {
  const hash = path.lastIndexOf('#')
  if (hash <= 0)
    return { file: path }
  return { file: path.slice(0, hash), sessionId: path.slice(hash + 1) }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value != null && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>
  return undefined
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

export function parseTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value))
    return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    if (!Number.isNaN(ms))
      return ms
  }
  return 0
}
