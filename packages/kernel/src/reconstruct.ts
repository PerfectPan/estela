import type { ReconstructResult, Trace } from '@rivus/agent-trace-schema'

/**
 * Model-visible surface at `eventId`: prefix of the log, minus events whose
 * `shadowedBy` compaction is already in that prefix.
 *
 * Does not invent messages, tools, or system prompts. Hosts that do not log
 * those slots report them in `unavailable`.
 */
export function reconstruct(trace: Trace, eventId: string): ReconstructResult {
  const index = trace.events.findIndex(e => e.id === eventId)
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
    prefix.filter(e => e.kind === 'compaction').map(e => e.id),
  )

  const visibleIds = prefix
    .filter(e => e.shadowedBy == null || !activeShadows.has(e.shadowedBy))
    .map(e => e.id)

  const unavailable: string[] = []
  if (!prefix.some(e => e.kind === 'system'))
    unavailable.push('system')
  if (!prefix.some(e => e.payload.tools != null))
    unavailable.push('tools')

  return {
    eventId,
    visibleIds,
    unavailable,
    completeness: unavailable.length === 0 ? 'full' : 'partial',
  }
}
