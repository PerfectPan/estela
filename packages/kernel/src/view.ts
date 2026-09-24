import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'

const DEFAULT_MAX = 4096

function capString(value: string, max: number, path: string, truncated: string[]): string {
  if (value.length <= max)
    return value
  truncated.push(path)
  return value.slice(0, max)
}

function capValue(value: unknown, max: number, path: string, truncated: string[]): unknown {
  if (typeof value === 'string')
    return capString(value, max, path, truncated)
  if (Array.isArray(value)) {
    return value.map((item, index) => capValue(item, max, path ? `${path}.${index}` : String(index), truncated))
  }
  if (value != null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key
      out[key] = capValue(item, max, next, truncated)
    }
    return out
  }
  return value
}

function capEvent(event: TraceEvent, max: number): TraceEvent {
  const truncated: string[] = []
  const payload = capValue(event.payload, max, '', truncated) as Record<string, unknown>
  if (truncated.length > 0)
    payload.$truncated = truncated
  const next: TraceEvent = { ...event, payload }
  delete next.original
  return next
}

/**
 * Drop `original`, cap every string, and mark shortened payload paths.
 * The ledger shows a shortened marker; the inspector calls `get-event`.
 */
export function toView(trace: Trace, opts?: { maxString?: number }): Trace {
  const max = opts?.maxString ?? DEFAULT_MAX
  const sessionTruncated: string[] = []
  const session = capValue(trace.session, max, '', sessionTruncated) as Trace['session']
  return {
    ...trace,
    session,
    events: trace.events.map(event => capEvent(event, max)),
  }
}
