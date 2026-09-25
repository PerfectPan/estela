import type { Lane, RequestEntry, Turn } from '@rivus/agent-trace-kernel'
import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { asString, foldHookRuns, hiddenAfterCompaction, mainAgentId, projectLanes, projectTurns } from '@rivus/agent-trace-kernel'
import { inRange } from './timeline-scale.ts'

/** The kind mark of a ledger row (docs/design/README.md palette). */
export type RowKind = 'user' | 'request' | 'tool' | 'thinking' | 'reply' | 'subagent' | 'system' | 'hook' | 'compaction' | 'unknown'

export type Entry =
  | { type: 'event', id: string, eventId: string, kind: RowKind, ordinal: number, resultId?: string }
  | { type: 'hooks', id: string, eventIds: string[], count: number }
  | { type: 'compaction', id: string, eventId: string }
  | { type: 'subagent', id: string, laneId: string, title?: string, eventId?: string, resultId?: string, ordinal?: number, children: Entry[] }

export interface TurnGroup {
  /** Stable key, `t<index>`. */
  id: string
  turn: Turn
  entries: Entry[]
  /** Events in this turn the model no longer sees after a compaction. */
  hidden: number
}

export interface LedgerModel {
  trace: Trace
  turns: TurnGroup[]
  lanes: Lane[]
  byId: Map<string, TraceEvent>
  /** Row number of each event that has its own row, except hooks and compactions (tool results share their call's). */
  ordinals: Map<string, number>
  /** Where an event is drawn: its turn, its entry, and the subagent or hooks entries to expand to reach it. */
  locate: Map<string, { turnId: string, entryId: string, parents: string[] }>
  hidden: Set<string>
  /** Tool results by call id. */
  results: Map<string, TraceEvent>
  /** `projectLanes` request entries by event id, with their lane and position on it. */
  requests: Map<string, { entry: RequestEntry, lane: Lane, index: number }>
  /** Every entry by id, including the single hook rows of an expanded hooks row. */
  entries: Map<string, Entry>
  /** Per compaction: how many events it hid, and the lowest and highest of their row numbers. */
  shadowed: Map<string, { count: number, from?: number, to?: number }>
}

function callIdOf(event: TraceEvent): string | undefined {
  return asString(event.payload.callId) || undefined
}

function rowKind(event: TraceEvent): RowKind {
  switch (event.kind) {
    case 'user': return 'user'
    case 'assistant': return 'reply'
    case 'thinking': return 'thinking'
    case 'tool_call':
    case 'tool_result': return 'tool'
    case 'request': return 'request'
    case 'system': return 'system'
    case 'hook': return 'hook'
    case 'compaction': return 'compaction'
    default: return 'unknown'
  }
}

/** Builds turns, entries, and row numbers once per trace. */
export function buildLedgerModel(trace: Trace): LedgerModel {
  const mainId = mainAgentId(trace)
  const byId = new Map(trace.events.map(event => [event.id, event]))
  const lanes = projectLanes(trace)
  const titles = new Map(lanes.flatMap(lane => lane.title ? [[lane.id, lane.title] as const] : []))
  const spawnOf = new Map<string, string>()
  for (const lane of lanes) {
    if (lane.id !== mainId && lane.spawnEventId && byId.has(lane.spawnEventId))
      spawnOf.set(lane.spawnEventId, lane.id)
  }
  const results = new Map<string, TraceEvent>()
  const calls = new Set<string>()
  for (const event of trace.events) {
    const callId = callIdOf(event)
    if (!callId)
      continue
    if (event.kind === 'tool_call')
      calls.add(callId)
    else if (event.kind === 'tool_result' && !results.has(callId))
      results.set(callId, event)
  }
  // A result is drawn on its call's row.
  const consumed = new Set<string>()
  for (const event of trace.events) {
    const callId = callIdOf(event)
    if (event.kind === 'tool_result' && callId && calls.has(callId) && results.get(callId) === event)
      consumed.add(event.id)
  }

  const ordinals = new Map<string, number>()
  let next = 1
  for (const event of trace.events) {
    // As in the design, hook runs and compaction rows carry no number.
    if (event.kind === 'hook' || event.kind === 'compaction' || consumed.has(event.id))
      continue
    ordinals.set(event.id, next++)
  }

  const locate: LedgerModel['locate'] = new Map()
  const all = new Map<string, Entry>()
  const hidden = hiddenAfterCompaction(trace)

  function entriesOf(events: TraceEvent[], turnId: string, parents: string[]): Entry[] {
    const out: Entry[] = []
    for (const row of foldHookRuns(events)) {
      if (row.type === 'hooks') {
        const id = `h:${row.eventIds[0]}`
        const hooks: Entry = { type: 'hooks', id, eventIds: row.eventIds, count: row.count }
        out.push(hooks)
        all.set(id, hooks)
        for (const eventId of row.eventIds) {
          locate.set(eventId, { turnId, entryId: `e:${eventId}`, parents: [...parents, id] })
          all.set(`e:${eventId}`, hookEntry(eventId))
        }
        continue
      }
      const event = byId.get(row.eventId)!
      if (consumed.has(event.id))
        continue
      const id = `e:${event.id}`
      const place = { turnId, entryId: id, parents }
      locate.set(event.id, place)
      if (event.kind === 'compaction') {
        const compaction: Entry = { type: 'compaction', id, eventId: event.id }
        out.push(compaction)
        all.set(id, compaction)
        continue
      }
      const entry: Entry = { type: 'event', id, eventId: event.id, kind: rowKind(event), ordinal: ordinals.get(event.id)! }
      const callId = event.kind === 'tool_call' ? callIdOf(event) : undefined
      const result = callId ? results.get(callId) : undefined
      if (result) {
        entry.resultId = result.id
        locate.set(result.id, place)
      }
      out.push(entry)
      all.set(id, entry)
    }
    return out
  }

  const turns: TurnGroup[] = projectTurns(trace).map((turn) => {
    const turnId = `t${turn.index}`
    const events = turn.eventIds.map(id => byId.get(id)!)
    const main: TraceEvent[] = []
    const byLane = new Map<string, TraceEvent[]>()
    for (const event of events) {
      const lane = event.agentId ?? mainId
      if (lane === mainId) {
        main.push(event)
        continue
      }
      const list = byLane.get(lane)
      if (list)
        list.push(event)
      else
        byLane.set(lane, [event])
    }
    const entries = entriesOf(main, turnId, [])
    // Subagent lanes: one row each, at the spawn event when it is in this turn, else before the lane's first event.
    for (const [laneId, laneEvents] of byLane) {
      const id = `s:${turnId}:${laneId}`
      const children = entriesOf(laneEvents, turnId, [id])
      if (children.length === 0)
        continue
      const spawnAt = entries.findIndex(entry => entry.type === 'event' && spawnOf.get(entry.eventId) === laneId)
      if (spawnAt >= 0) {
        const spawn = entries[spawnAt] as Extract<Entry, { type: 'event' }>
        const entry: Entry = { type: 'subagent', id, laneId, title: titles.get(laneId), eventId: spawn.eventId, ordinal: spawn.ordinal, children }
        if (spawn.resultId)
          entry.resultId = spawn.resultId
        entries[spawnAt] = entry
        all.set(id, entry)
        locate.set(spawn.eventId, { turnId, entryId: id, parents: [] })
        if (spawn.resultId)
          locate.set(spawn.resultId, { turnId, entryId: id, parents: [] })
        continue
      }
      const firstSeq = laneEvents[0]!.seq
      const at = entries.findIndex(entry => byId.get(entryEventIds(entry)[0]!)!.seq > firstSeq)
      const entry: Entry = { type: 'subagent', id, laneId, title: titles.get(laneId), children }
      entries.splice(at < 0 ? entries.length : at, 0, entry)
      all.set(id, entry)
    }
    let hiddenCount = 0
    for (const event of events) {
      if (hidden.has(event.id))
        hiddenCount += 1
    }
    return { id: turnId, turn, entries, hidden: hiddenCount }
  })

  const shadowed = new Map<string, { count: number, from?: number, to?: number }>()
  for (const event of trace.events) {
    if (!event.shadowedBy)
      continue
    const stats = shadowed.get(event.shadowedBy) ?? { count: 0 }
    stats.count += 1
    const ordinal = ordinals.get(event.id)
    if (ordinal !== undefined) {
      stats.from = Math.min(stats.from ?? ordinal, ordinal)
      stats.to = Math.max(stats.to ?? ordinal, ordinal)
    }
    shadowed.set(event.shadowedBy, stats)
  }

  const requests: LedgerModel['requests'] = new Map()
  for (const lane of lanes)
    lane.requests.forEach((entry, index) => requests.set(entry.id, { entry, lane, index }))

  return { trace, turns, lanes, byId, ordinals, locate, hidden, results, requests, entries: all, shadowed }
}

/** One hook of a folded run, drawn when its hooks row is expanded. Hooks carry no row number. */
function hookEntry(eventId: string): Entry {
  return { type: 'event', id: `e:${eventId}`, eventId, kind: 'hook', ordinal: 0 }
}

/** The events an entry draws, its main event first (a subagent row: the spawn call, then its lane's rows). */
export function entryEventIds(entry: Entry): string[] {
  switch (entry.type) {
    case 'event':
    case 'compaction': return [entry.eventId]
    case 'hooks': return entry.eventIds
    case 'subagent': return [...(entry.eventId ? [entry.eventId] : []), ...entry.children.flatMap(entryEventIds)]
  }
}

export type LedgerFilter = 'all' | 'requests' | 'tools' | 'failures'

export interface LedgerView {
  collapsed: ReadonlySet<string>
  expanded: ReadonlySet<string>
  filter: LedgerFilter
  /** Epoch ms; `undefined` is the whole session. */
  range?: { from: number, to: number }
}

export type VirtualRow =
  | { key: string, type: 'turn', group: TurnGroup, collapsed: boolean, size: number }
  | { key: string, type: 'entry', entry: Entry, depth: 0 | 1, expanded: boolean, size: number, /** Inside an expanded subagent lane. */ lane: boolean }

/** Fixed heights (3.6): 36 px rows, 40 px turn headers; the design's hook fold row is 30 px and the compaction row 44 px. */
export const ROW_SIZE = { turn: 40, event: 36, hooks: 30, compaction: 44 } as const

function rowSize(row: { type: 'turn' } | { type: 'entry', entry: Entry }): number {
  if (row.type === 'turn')
    return ROW_SIZE.turn
  if (row.entry.type === 'hooks')
    return ROW_SIZE.hooks
  if (row.entry.type === 'compaction')
    return ROW_SIZE.compaction
  return ROW_SIZE.event
}

export function isFailedResult(event: TraceEvent | undefined): boolean {
  return event?.kind === 'tool_result' && event.payload.isError === true
}

/** Whether an entry passes the kind chip and the brush range. A subagent row passes when one of its rows does. */
export function entryMatches(entry: Entry, model: LedgerModel, view: LedgerView): boolean {
  const inside = (ts: number) => inRange(ts, view.range)
  if (entry.type === 'subagent') {
    if (view.filter === 'all' && entry.eventId && inside(model.byId.get(entry.eventId)!.ts))
      return true
    return entry.children.some(child => entryMatches(child, model, view))
  }
  if (!entryEventIds(entry).some(id => inside(model.byId.get(id)!.ts)))
    return false
  if (view.filter === 'all')
    return true
  if (entry.type !== 'event')
    return false
  if (view.filter === 'requests')
    return entry.kind === 'request'
  if (view.filter === 'tools')
    return entry.kind === 'tool'
  return entry.kind === 'tool' && isFailedResult(entry.resultId ? model.byId.get(entry.resultId) : undefined)
}

function pushEntry(out: VirtualRow[], entry: Entry, depth: 0 | 1, lane: boolean, model: LedgerModel, view: LedgerView): void {
  if (!entryMatches(entry, model, view))
    return
  const expanded = view.expanded.has(entry.id)
  out.push({ key: entry.id, type: 'entry', entry, depth, expanded, lane, size: rowSize({ type: 'entry', entry }) })
  if (!expanded)
    return
  if (entry.type === 'subagent') {
    for (const child of entry.children)
      pushEntry(out, child, 1, true, model, view)
  }
  else if (entry.type === 'hooks') {
    for (const eventId of entry.eventIds) {
      const hook = hookEntry(eventId)
      if (entryMatches(hook, model, view))
        out.push({ key: hook.id, type: 'entry', entry: hook, depth: 1, expanded: false, lane, size: ROW_SIZE.event })
    }
  }
}

/**
 * The rows the virtualizer draws: turn headers, then (unless collapsed) the
 * entries that pass the chip and range, with expanded subagent and hook rows
 * inlined one level deep. A turn with no passing entry is left out while a
 * filter or range is active.
 */
export function flattenLedger(model: LedgerModel, view: LedgerView): VirtualRow[] {
  const out: VirtualRow[] = []
  const filtering = view.filter !== 'all' || view.range !== undefined
  for (const group of model.turns) {
    const rows: VirtualRow[] = []
    for (const entry of group.entries)
      pushEntry(rows, entry, 0, false, model, view)
    if (filtering && rows.length === 0)
      continue
    const collapsed = view.collapsed.has(group.id)
    out.push({ key: group.id, type: 'turn', group, collapsed, size: ROW_SIZE.turn })
    if (!collapsed)
      out.push(...rows)
  }
  return out
}

/** Up / down in the list: the next row index, clamped; `-1` selects the first row. */
export function moveSelection(count: number, current: number, delta: number): number {
  if (count === 0)
    return -1
  if (current < 0)
    return delta < 0 ? count - 1 : 0
  return Math.min(count - 1, Math.max(0, current + delta))
}

/** Number of trace events whose time is inside the range (the timeline header count). */
export function countEvents(trace: Trace, range?: { from: number, to: number }): number {
  if (!range)
    return trace.events.length
  let count = 0
  for (const event of trace.events) {
    if (inRange(event.ts, range))
      count += 1
  }
  return count
}

/**
 * The row the keyboard continues from: the selected row when it is drawn, else the header
 * of its turn (collapse, a chip, or the range hid it), else nothing.
 */
export function anchorIndex(rows: readonly VirtualRow[], model: LedgerModel, key: string | undefined): number {
  if (!key)
    return -1
  const at = rows.findIndex(row => row.key === key)
  if (at >= 0)
    return at
  const entry = model.entries.get(key)
  const eventId = entry ? entryEventIds(entry)[0] : undefined
  const turnId = eventId ? model.locate.get(eventId)?.turnId : undefined
  return turnId ? rows.findIndex(row => row.key === turnId) : -1
}
