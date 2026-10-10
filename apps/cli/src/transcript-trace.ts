import type { Trace, TraceEvent, TraceSession } from '@rivus/agent-trace-schema'
import type { Transcript } from '@rivus/agent-kit/transcript'

/**
 * Maps a kit `Transcript` onto the repo's canonical `Trace`, back-translating the names PR 2b
 * adopts into the schema (kind and capability `reasoning` → `thinking`, request
 * `finishReason` → `stopReason`) and reshaping `skipped`. Fields the schema does not know yet
 * (`granularity`, `modelCalls`, `usageByModel`, `totalTokens`, `cacheWrite1hTokens`) stay inside
 * `payload`: payloads are records, not validated. Whole function is removed by PR 2b.
 */
export function transcriptToTrace(transcript: Transcript): Trace {
  return {
    schema: 'agent-trace',
    host: {
      id: transcript.agent,
      ...(transcript.agentVersion !== undefined ? { version: transcript.agentVersion } : {}),
    },
    session: transcript.session as TraceSession,
    capabilities: transcript.capabilities.map(capability => (capability === 'reasoning' ? 'thinking' : capability)),
    agents: transcript.agents,
    events: transcript.events.map(event => traceEvent(event)),
    skipped: transcript.skipped.map(skip => ({
      file: skip.source.file,
      line: skip.source.line,
      reason: skip.reason,
    })),
  }
}

function traceEvent(event: Transcript['events'][number]): TraceEvent {
  return {
    id: event.id,
    seq: event.seq,
    ts: event.ts,
    kind: event.kind === 'reasoning' ? 'thinking' : event.kind,
    ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
    ...(event.parentId !== undefined ? { parentId: event.parentId } : {}),
    ...(event.requestId !== undefined ? { requestId: event.requestId } : {}),
    ...(event.shadowedBy !== undefined ? { shadowedBy: event.shadowedBy } : {}),
    payload: tracePayload(event.payload),
    source: event.source,
    ...(event.original !== undefined ? { original: event.original } : {}),
  }
}

function tracePayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.finishReason === undefined) {
    return payload
  }
  const { finishReason, ...rest } = payload
  return { ...rest, stopReason: finishReason }
}
