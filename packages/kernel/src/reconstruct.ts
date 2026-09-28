import type { ReconstructResult, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { asNumber, asRecord } from './jsonl.ts'

function firstRequestAfterCompaction(events: TraceEvent[], index: number): TraceEvent | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const event = events[cursor]!
    if (event.kind === 'request')
      return undefined
    if (event.kind === 'compaction')
      return event
  }
  return undefined
}

/**
 * Model-visible surface at `eventId`: prefix of the log, minus events whose
 * `shadowedBy` compaction is already in that prefix.
 *
 * Does not invent messages, tools, or system prompts. Hosts that do not log
 * those slots report them in `unavailable`. Token counts are copied only when
 * the host recorded them.
 */
export function reconstruct(trace: Trace, eventId: string): ReconstructResult {
  const index = trace.events.findIndex(event => event.id === eventId)
  if (index < 0) {
    return {
      eventId,
      visibleIds: [],
      unavailable: ['event'],
      completeness: 'unavailable',
    }
  }

  const prefix = trace.events.slice(0, index + 1)
  const activeShadows = new Set(
    prefix.filter(event => event.kind === 'compaction').map(event => event.id),
  )
  const visibleIds = prefix
    .filter(event => event.shadowedBy == null || !activeShadows.has(event.shadowedBy))
    .map(event => event.id)

  const unavailable: string[] = []
  const hasSystem = trace.capabilities.includes('systemPrompt') && Boolean(trace.session.systemPrompt)
  const hasTools = trace.session.tools != null || prefix.some(event => event.payload.tools != null)
  if (!hasSystem)
    unavailable.push('system')
  if (!hasTools)
    unavailable.push('tools')

  const result: ReconstructResult = {
    eventId,
    visibleIds,
    unavailable,
    completeness: unavailable.length === 0 ? 'full' : 'partial',
  }
  const target = prefix[index]!
  if (target.kind !== 'request')
    return result

  const inputTokens = asNumber(asRecord(target.payload.usage)?.inputTokens)
  if (inputTokens !== undefined)
    result.inputTokens = inputTokens
  const compaction = firstRequestAfterCompaction(trace.events, index)
  const postTokens = asNumber(compaction?.payload.postTokens)
  if (postTokens !== undefined)
    result.postTokens = postTokens
  return result
}
