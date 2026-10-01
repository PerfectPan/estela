import type { TraceEvent } from '@rivus/agent-trace-schema'

export function assignSeq(events: TraceEvent[]): void {
  for (let index = 0; index < events.length; index++) {
    events[index]!.seq = index
  }
}

/** A tool result with no earlier call in the same agent is `orphan`. */
export function markOrphanToolResults(events: TraceEvent[]): void {
  const seen = new Set<string>()
  for (const event of events) {
    const callId = typeof event.payload.callId === 'string' ? event.payload.callId : undefined
    const agent = event.agentId ?? ''
    if (event.kind === 'tool_call' && callId) {
      seen.add(`${agent}\0${callId}`)
      continue
    }
    if (event.kind === 'tool_result' && !seen.has(`${agent}\0${callId ?? ''}`)) {
      event.payload.orphan = true
    }
  }
}
