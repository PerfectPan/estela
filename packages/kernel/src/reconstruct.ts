import type { ContextSlot, ContextSlotName, ContextTokens, ReconstructResult, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { asNumber, asString } from './jsonl.ts'
import { isPrompt, laneOf, mainAgentId, recordKey, requestUsage, shadowedIn } from './lanes.ts'

const MESSAGE_KINDS = new Set<TraceEvent['kind']>(['user', 'assistant', 'thinking', 'tool_call', 'tool_result'])
const ALL_SLOTS: ContextSlotName[] = ['system', 'tools', 'summary', 'messages', 'currentTurn']

/** The compaction just before a request on the same lane, when no other request of that lane sits between them. */
function compactionBefore(events: TraceEvent[], index: number, lane: string, mainId: string): TraceEvent | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const event = events[cursor]!
    if (laneOf(event, mainId) !== lane)
      continue
    if (event.kind === 'request')
      return undefined
    if (event.kind === 'compaction')
      return event
  }
  return undefined
}

function summaryIds(prefix: TraceEvent[]): Set<string> {
  const ids = new Set<string>()
  for (const event of prefix) {
    if (event.kind === 'compaction') {
      ids.add(event.id)
      const summary = asString(event.payload.summaryEventId)
      if (summary)
        ids.add(summary)
    }
    else if (event.kind === 'user' && event.payload.compactSummary === true) {
      ids.add(event.id)
    }
  }
  return ids
}

/**
 * Index in `visible` where the current turn starts: the last prompt record's
 * first event. A subagent lane with no prompt record (its task arrives as a
 * tool call) starts its turn at the lane start; the main lane without a prompt
 * has no current turn (-1), so everything visible is `messages`.
 */
function turnStart(visible: TraceEvent[], mainLane: boolean): number {
  for (let cursor = visible.length - 1; cursor >= 0; cursor--) {
    const event = visible[cursor]!
    if (!isPrompt(event))
      continue
    let first = cursor
    while (first > 0 && isPrompt(visible[first - 1]!) && recordKey(visible[first - 1]!) === recordKey(event))
      first -= 1
    return first
  }
  return mainLane ? -1 : 0
}

function slot(name: ContextSlotName, recorded: boolean, eventIds: string[], present = eventIds.length > 0): ContextSlot {
  return { name, status: recorded ? (present ? 'present' : 'empty') : 'unavailable', eventIds }
}

/** The session system prompt belongs to the main lane; a subagent lane needs its own. */
function systemRecorded(trace: Trace, lane: string, mainId: string): boolean {
  if (!trace.capabilities.includes('systemPrompt'))
    return false
  if (lane === mainId)
    return Boolean(trace.session.systemPrompt)
  return Boolean(trace.agents.find(agent => agent.id === lane)?.systemPrompt)
}

function slotsOf(trace: Trace, lane: string, mainId: string, prefix: TraceEvent[], visible: TraceEvent[]): ContextSlot[] {
  const hasSystem = systemRecorded(trace, lane, mainId)
  const hasTools = trace.session.tools != null || prefix.some(event => event.payload.tools != null)
  const recordsCompaction = trace.capabilities.includes('compaction') || prefix.some(event => event.kind === 'compaction')
  const summaries = summaryIds(prefix)
  const summary: string[] = []
  const messages: string[] = []
  const current: string[] = []
  const start = turnStart(visible, lane === mainId)
  visible.forEach((event, position) => {
    if (summaries.has(event.id)) {
      summary.push(event.id)
      return
    }
    if (!MESSAGE_KINDS.has(event.kind))
      return
    if (start >= 0 && position >= start)
      current.push(event.id)
    else
      messages.push(event.id)
  })
  return [
    slot('system', hasSystem, [], hasSystem),
    slot('tools', hasTools, [], hasTools),
    slot('summary', recordsCompaction, summary),
    slot('messages', true, messages),
    slot('currentTurn', true, current),
  ]
}

function tokensOf(target: TraceEvent, compaction: TraceEvent | undefined): ContextTokens[] {
  const tokens: ContextTokens[] = []
  if (target.kind !== 'request')
    return tokens
  const { inputTokens } = requestUsage(target)
  if (inputTokens !== undefined)
    tokens.push({ slots: [...ALL_SLOTS], tokens: inputTokens, from: 'request.inputTokens' })
  const postTokens = asNumber(compaction?.payload.postTokens)
  if (postTokens !== undefined)
    tokens.push({ slots: ['system', 'tools', 'summary', 'messages'], tokens: postTokens, from: 'compaction.postTokens' })
  return tokens
}

/**
 * Model-visible surface at `eventId` on that event's lane: the prefix of the
 * log, minus events whose `shadowedBy` compaction is already in that prefix.
 *
 * Does not invent messages, tools, or system prompts. Slots a host does not
 * log are `unavailable`. Token counts are copied only when the host recorded
 * them: the request's input tokens, and the compaction's `postTokens` when this
 * is the first request after it. Slot sizes are never estimated from text.
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

  const mainId = mainAgentId(trace)
  const target = trace.events[index]!
  const lane = laneOf(target, mainId)
  // Lane-scoped: a model call sees only its own agent's events, never another lane's.
  const prefix = trace.events.slice(0, index + 1).filter(event => laneOf(event, mainId) === lane)
  const hidden = shadowedIn(prefix)
  const visible = prefix.filter(event => !hidden.has(event.id))
  const removedIds = prefix.filter(event => hidden.has(event.id)).map(event => event.id)

  const slots = slotsOf(trace, lane, mainId, prefix, visible)
  const unavailable = slots.filter(item => item.status === 'unavailable').map(item => item.name)
  const tokens = tokensOf(target, compactionBefore(trace.events, index, lane, mainId))
  return {
    eventId,
    visibleIds: visible.map(event => event.id),
    unavailable,
    completeness: unavailable.length === 0 ? 'full' : 'partial',
    slots,
    tokens,
    removedIds,
  }
}
