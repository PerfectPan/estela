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
