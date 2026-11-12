import type { EventOf, Trace, TraceEvent } from '@rivus/estela-schema'

const MAIN = 'main'

/** Id of the root agent: the first `agents[]` entry without a parent, else `main`. */
export function mainAgentId(trace: Trace): string {
  return trace.agents.find(agent => agent.parentId == null)?.id ?? MAIN
}

/** Lane of one event. Events without `agentId` belong to the main agent. */
export function laneOf(event: TraceEvent, mainId: string): string {
  return event.agentId ?? mainId
}

/**
 * A real user prompt. Not prompts: meta records (`payload.meta`), compact
 * summaries (`payload.compactSummary`), command wrappers (`payload.command`),
 * agent-injected environment or instruction messages (`payload.injected`), and
 * later chunks of one prompt (`payload.continued`).
 */
export function isPrompt(event: TraceEvent): boolean {
  if (event.kind !== 'user') {
    return false
  }
  const payload = event.payload
  return !(
    payload.meta === true
    || payload.compactSummary === true
    || payload.command === true
    || payload.injected === true
    || payload.continued === true
  )
}

/** Key of the log record an event came from. Content blocks of one record share it. */
export function recordKey(event: TraceEvent): string {
  return `${event.source.file}\0${event.source.line}`
}

/**
 * Index in `events` where the prompt record at `at` starts: the record's first
 * user-kind event on the walk back. The kit marks a record's host-added blocks
 * (system reminders, IDE context) `injected` per block, so they are user-kind
 * but no prompt; a tool_result in the record stays outside, with its call.
 */
export function recordUserStart(events: readonly TraceEvent[], at: number): number {
  let first = at
  while (first > 0 && events[first - 1]!.kind === 'user' && recordKey(events[first - 1]!) === recordKey(events[at]!)) {
    first -= 1
  }
  return first
}

/**
 * Ids of the events that start a turn on `lane`: the first event of each
 * prompt record (several content blocks of one record start one turn).
 */
export function promptStarts(trace: Trace, lane?: string): TraceEvent[] {
  const mainId = mainAgentId(trace)
  const seen = new Set<string>()
  const out: TraceEvent[] = []
  for (const event of trace.events) {
    if (!isPrompt(event)) {
      continue
    }
    if (lane !== undefined && laneOf(event, mainId) !== lane) {
      continue
    }
    const key = `${laneOf(event, mainId)}\0${recordKey(event)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(event)
  }
  return out
}

/** Recorded input and output tokens of a `request` event; a field is absent when not recorded. */
export function requestUsage(event: EventOf<'request'>): { inputTokens?: number; outputTokens?: number } {
  const usage = event.payload.usage
  const out: { inputTokens?: number; outputTokens?: number } = {}
  if (usage?.inputTokens !== undefined) {
    out.inputTokens = usage.inputTokens
  }
  if (usage?.outputTokens !== undefined) {
    out.outputTokens = usage.outputTokens
  }
  return out
}

/** Ids of the events in `events` hidden by a compaction that is also in `events`. */
export function shadowedIn(events: readonly TraceEvent[]): Set<string> {
  const compactions = new Set(events.filter(event => event.kind === 'compaction').map(event => event.id))
  const hidden = new Set<string>()
  for (const event of events) {
    if (event.shadowedBy != null && compactions.has(event.shadowedBy)) {
      hidden.add(event.id)
    }
  }
  return hidden
}

/** Every lane of a trace: the main lane, then the declared lanes, then any lane an event names. */
export function laneIds(trace: Trace): string[] {
  const mainId = mainAgentId(trace)
  const out = [mainId]
  for (const lane of trace.agents) {
    if (lane.id !== mainId && !out.includes(lane.id)) {
      out.push(lane.id)
    }
  }
  for (const event of trace.events) {
    const laneId = laneOf(event, mainId)
    if (!out.includes(laneId)) {
      out.push(laneId)
    }
  }
  return out
}
