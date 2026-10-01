import type { Capability, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { SourcedRecord } from './records.ts'
import { TRACE_SCHEMA } from '@rivus/agent-trace-schema'
import { asRecord } from './jsonl.ts'
import { basenamePath } from './path.ts'
import { sourceOf } from './records.ts'
import { timeOf } from './time.ts'

export interface ParsedSession {
  events: TraceEvent[]
  skipped: Trace['skipped']
  session: Trace['session']
  version?: string
  agents: Trace['agents']
}

export function toTrace(hostId: string, capabilities: readonly Capability[], parsed: ParsedSession): Trace {
  return {
    schema: TRACE_SCHEMA,
    host: { id: hostId, ...(parsed.version ? { version: parsed.version } : {}) },
    session: parsed.session,
    capabilities: [...capabilities],
    agents: parsed.agents,
    events: parsed.events,
    skipped: parsed.skipped,
  }
}

export function lineId(record: SourcedRecord, part = 0): string {
  const base = basenamePath(record.file)
  return part === 0 ? `${base}:${record.line}` : `${base}:${record.line}:${part}`
}

export function baseEvent(
  record: SourcedRecord,
  kind: TraceEvent['kind'],
  payload: Record<string, unknown>,
  fields?: { id?: string; ts?: number; agentId?: string; parentId?: string; requestId?: string },
): TraceEvent {
  const event: TraceEvent = {
    id: fields?.id ?? lineId(record),
    seq: 0,
    ts: fields?.ts ?? 0,
    kind,
    payload,
    source: sourceOf(record),
    original: record.value,
  }
  if (fields?.agentId) {
    event.agentId = fields.agentId
  }
  if (fields?.parentId) {
    event.parentId = fields.parentId
  }
  if (fields?.requestId) {
    event.requestId = fields.requestId
  }
  return event
}

export function skipRecord(skipped: Trace['skipped'], record: SourcedRecord, reason: string): void {
  skipped.push({ file: record.file, line: record.line, reason })
}

/** Hide earlier events of the compaction's agent. `keep` returns true for events that stay visible. */
export function shadowBefore(
  events: TraceEvent[],
  compaction: TraceEvent,
  keep?: (event: TraceEvent) => boolean,
): void {
  const agent = compaction.agentId ?? ''
  for (const event of events) {
    if (event === compaction) {
      break
    }
    if ((event.agentId ?? '') !== agent || event.kind === 'compaction' || event.shadowedBy) {
      continue
    }
    if (keep?.(event)) {
      continue
    }
    event.shadowedBy = compaction.id
  }
}

const OUTPUT_KINDS = new Set<TraceEvent['kind']>(['assistant', 'thinking', 'tool_call'])

/**
 * Insert a request event for a host that writes usage after the call's output.
 * It goes before the first model output at or after `from` (else at the end), so
 * the prefix up to it is the call's input. Its `ts` becomes that output's `ts`,
 * which keeps `ts` non-decreasing. Events from `from` on without a `requestId`
 * join the request. Returns the start of the next segment.
 */
export function placeRequest(events: TraceEvent[], from: number, request: TraceEvent): number {
  let at = events.length
  for (let index = from; index < events.length; index++) {
    if (OUTPUT_KINDS.has(events[index]!.kind)) {
      at = index
      break
    }
  }
  if (at < events.length) {
    request.ts = events[at]!.ts
  }
  events.splice(at, 0, request)
  for (let index = from; index < events.length; index++) {
    const event = events[index]!
    if (event !== request && !event.requestId && request.requestId) {
      event.requestId = request.requestId
    }
  }
  return events.length
}

/**
 * Fill missing timestamps from the previous record in file order.
 * A leading gap copies the next known timestamp. The result is never 0.
 */
export function inheritTimes(records: readonly SourcedRecord[]): number[] {
  const times = records.map(record => timeOf(asRecord(record.value)?.timestamp))
  let last: number | undefined
  for (let index = 0; index < times.length; index++) {
    if (times[index] === undefined) {
      times[index] = last
    } else {
      last = times[index]
    }
  }
  const known = times.find(value => value !== undefined)
  if (known !== undefined) {
    for (let index = 0; index < times.length; index++) {
      if (times[index] === undefined) {
        times[index] = known
      } else {
        break
      }
    }
  }
  return times.map(value => value ?? known ?? 1)
}

/**
 * Merge files (main transcript, then subagents) without reordering any file.
 * Each step takes the head record with the smallest timestamp; a tie goes to
 * the earlier file. Timestamps inside one file may go backwards (Claude writes a
 * compact summary with an earlier time than the boundary it follows), and file
 * order wins over them.
 */
export function mergeByTime(groups: SourcedRecord[][]): { record: SourcedRecord; ts: number }[] {
  const times = groups.map(group => inheritTimes(group))
  const cursor = groups.map(() => 0)
  const out: { record: SourcedRecord; ts: number }[] = []
  for (;;) {
    let pick = -1
    for (let index = 0; index < groups.length; index++) {
      if (cursor[index]! >= groups[index]!.length) {
        continue
      }
      if (pick < 0 || times[index]![cursor[index]!]! < times[pick]![cursor[pick]!]!) {
        pick = index
      }
    }
    if (pick < 0) {
      return out
    }
    const at = cursor[pick]!
    out.push({ record: groups[pick]![at]!, ts: times[pick]![at]! })
    cursor[pick] = at + 1
  }
}
