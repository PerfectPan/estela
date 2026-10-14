import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { mainAgentId, promptStarts, requestUsage, shadowedIn } from './lanes.ts'

/** A ledger row: one event, or one run of consecutive `hook` events. */
export type TurnRow = { type: 'event'; eventId: string } | { type: 'hooks'; eventIds: string[]; count: number }

export interface TurnTotals {
  events: number
  requests: number
  /** Sum over requests that recorded it; `undefined` when none did. */
  inputTokens?: number
  outputTokens?: number
  failedTools: number
  /** From a `turn_duration` marker in the turn, else the sum of request durations; `undefined` when neither is recorded. */
  durationMs?: number
}

export interface Turn {
  /** 0-based. Turn 0 has no prompt when events precede the first prompt. */
  index: number
  /** The main-lane prompt that starts this turn. */
  promptEventId?: string
  startTs: number
  endTs: number
  /** Every event in the turn, any lane, in trace order. */
  eventIds: string[]
  rows: TurnRow[]
  totals: TurnTotals
}

function addKnown(total: number | undefined, value: number | undefined): number | undefined {
  if (value === undefined) {
    return total
  }
  return (total ?? 0) + value
}

function totalsOf(events: TraceEvent[]): TurnTotals {
  const totals: TurnTotals = { events: events.length, requests: 0, failedTools: 0 }
  let marked: number | undefined
  let requestDuration: number | undefined
  for (const event of events) {
    if (event.kind === 'request') {
      totals.requests += 1
      const usage = requestUsage(event)
      const input = addKnown(totals.inputTokens, usage.inputTokens)
      if (input !== undefined) {
        totals.inputTokens = input
      }
      const output = addKnown(totals.outputTokens, usage.outputTokens)
      if (output !== undefined) {
        totals.outputTokens = output
      }
      requestDuration = addKnown(requestDuration, event.payload.durationMs)
    } else if (event.kind === 'tool_result' && event.payload.isError === true) {
      totals.failedTools += 1
    } else if (event.kind === 'system' && event.payload.type === 'turn_duration') {
      marked = addKnown(marked, event.payload.durationMs)
    }
  }
  const duration = marked ?? requestDuration
  if (duration !== undefined) {
    totals.durationMs = duration
  }
  return totals
}

/** Consecutive `hook` events become one row with a count. */
export function foldHookRuns(events: readonly TraceEvent[]): TurnRow[] {
  const rows: TurnRow[] = []
  for (const event of events) {
    const last = rows.at(-1)
    if (event.kind === 'hook') {
      if (last?.type === 'hooks') {
        last.eventIds.push(event.id)
        last.count += 1
      } else {
        rows.push({ type: 'hooks', eventIds: [event.id], count: 1 })
      }
      continue
    }
    rows.push({ type: 'event', eventId: event.id })
  }
  return rows
}

function turnOf(index: number, events: TraceEvent[], prompt?: TraceEvent): Turn {
  const turn: Turn = {
    index,
    startTs: events[0]!.ts,
    endTs: events.at(-1)!.ts,
    eventIds: events.map(event => event.id),
    rows: foldHookRuns(events),
    totals: totalsOf(events),
  }
  if (prompt) {
    turn.promptEventId = prompt.id
  }
  return turn
}

/**
 * Events grouped by turn. A turn starts at a main-lane prompt and holds every
 * event, on any lane, until the next one. Subagent work falls in the turn that
 * spawned it.
 */
export function projectTurns(trace: Trace): Turn[] {
  const starts = new Set(promptStarts(trace, mainAgentId(trace)).map(event => event.id))
  const turns: Turn[] = []
  let current: TraceEvent[] = []
  let prompt: TraceEvent | undefined
  for (const event of trace.events) {
    if (starts.has(event.id) && current.length > 0) {
      turns.push(turnOf(turns.length, current, prompt))
      current = []
    }
    if (starts.has(event.id)) {
      prompt = event
    }
    current.push(event)
  }
  if (current.length > 0) {
    turns.push(turnOf(turns.length, current, prompt))
  }
  return turns
}

/**
 * Events the model no longer sees: `shadowedBy` names a compaction that is in
 * the trace and, when `atEventId` is given, at or before that event.
 */
export function hiddenAfterCompaction(trace: Trace, atEventId?: string): Set<string> {
  if (atEventId === undefined) {
    return shadowedIn(trace.events)
  }
  const at = trace.events.findIndex(event => event.id === atEventId)
  return at < 0 ? new Set() : shadowedIn(trace.events.slice(0, at + 1))
}
