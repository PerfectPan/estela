import type { Trace, TraceEvent } from '@agent-trace/schema'

const SECRET = /(?:sk-|AKIA|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g

function redactValue(value: unknown): unknown {
  if (typeof value === 'string')
    return value.replace(SECRET, '[redacted]')
  if (Array.isArray(value))
    return value.map(redactValue)
  if (value != null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      out[k] = redactValue(v)
    return out
  }
  return value
}

function redactEvent(event: TraceEvent): TraceEvent {
  return {
    ...event,
    payload: redactValue(event.payload) as Record<string, unknown>,
    original: redactValue(event.original),
  }
}

/** Default-on for static export. Mutates nothing; returns a copy. */
export function redact(trace: Trace): Trace {
  return {
    ...trace,
    events: trace.events.map(redactEvent),
  }
}
