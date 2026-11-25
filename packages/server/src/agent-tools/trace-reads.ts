import type { Trace, TraceEvent } from '@rivus/estela-schema'
import { fold, projectLanes, projectRequests, projectTurns, summaryOf } from '@rivus/estela-kernel'
import type { TraceIds } from '@rivus/estela-rpc'
import {
  FIELD_CHARS,
  ITEM_IDS,
  iso,
  jsonChars,
  pageWithin,
  PATH_CHARS,
  PROMPT_CHARS,
  put,
  RESULT_CHARS,
  shown,
  SUMMARY_LANES,
  TITLE_CHARS,
  type Redaction,
} from './bounds.ts'

const NUMBERS = [
  'turns',
  'requests',
  'inputTokens',
  'outputTokens',
  'durationMs',
  'compactions',
  'subagents',
  'failedTools',
] as const
type NumberName = (typeof NUMBERS)[number]

interface LaneItem {
  id: string
  parentId?: string
  title?: string
  /** 0 for the main lane, 1 for its subagents, and so on. */
  depth: number
  /** The event that started this subagent. */
  spawnEventId?: string
  /** `true` when the session records this subagent, but its own log is missing or could not be read. */
  unavailable?: true
  requests: number
  failedTools: number
  compactions: number
}

export interface SessionSummaryResult {
  traceId: string
  agent: string
  agentVersion?: string
  title?: string
  cwd?: string
  startedAt?: string
  endedAt?: string
  /** Events read from the log, and log records that became no event. */
  events: number
  skippedRecords: number
  /** What this session's log records. A kind of data not listed is not recorded, so its counts are unavailable. */
  capabilities: string[]
  /** Recorded counts only. */
  numbers: Partial<Record<NumberName, number>>
  /** Counts this session's log does not record. */
  unavailable: NumberName[]
  lanes: LaneItem[]
  /** Lanes in the session; `lanes` holds at most 50. */
  laneCount: number
  truncated?: (string | number)[][]
}

/**
 * What a session holds: identity, recorded counts (and which are unavailable), capabilities, and lanes. Strings are
 * redacted, then cut; lanes are halved until the redacted result fits its size bound.
 */
export function sessionSummary(
  trace: Trace,
  traceId: string,
  ids: TraceIds,
  redaction: Redaction,
): SessionSummaryResult {
  const summary = summaryOf(fold(trace))
  const numbers: Partial<Record<NumberName, number>> = {}
  const unavailable: NumberName[] = []
  for (const name of NUMBERS) {
    const value = summary[name]
    if (value === undefined) {
      unavailable.push(name)
    } else {
      numbers[name] = value
    }
  }
  const lanes = projectLanes(trace)
  const build = (keep: number): SessionSummaryResult => {
    const truncated: (string | number)[][] = []
    const result: SessionSummaryResult = {
      traceId,
      agent: trace.agent,
      events: trace.events.length,
      skippedRecords: trace.skipped.reduce((total, entry) => total + (entry.count ?? 1), 0),
      capabilities: [...trace.capabilities],
      numbers,
      unavailable,
      lanes: lanes.slice(0, keep).map((lane, index) => {
        const item: LaneItem = {
          id: ids.lane(lane.id),
          depth: lane.depth,
          requests: lane.requests.length,
          failedTools: lane.markers.filter(marker => marker.kind === 'failed-tool').length,
          compactions: lane.markers.filter(marker => marker.kind === 'compaction').length,
        }
        put(item, 'parentId', lane.parentId === undefined ? undefined : ids.lane(lane.parentId))
        if (lane.title !== undefined) {
          const title = shown(lane.title, TITLE_CHARS, redaction)
          item.title = title.text
          if (title.cut) {
            truncated.push(['lanes', index, 'title'])
          }
        }
        put(item, 'spawnEventId', lane.spawnEventId === undefined ? undefined : ids.event(lane.spawnEventId))
        put(item, 'unavailable', lane.unavailable)
        return item
      }),
      laneCount: lanes.length,
    }
    if (trace.agentVersion !== undefined) {
      result.agentVersion = shown(trace.agentVersion, FIELD_CHARS, redaction).text
    }
    for (const [field, value, max] of [
      ['title', trace.session.title, TITLE_CHARS],
      ['cwd', trace.session.cwd, PATH_CHARS],
    ] as const) {
      if (value !== undefined) {
        const text = shown(value, max, redaction)
        result[field] = text.text
        if (text.cut) {
          truncated.push([field])
        }
      }
    }
    put(result, 'startedAt', trace.session.startedAt === undefined ? undefined : iso(trace.session.startedAt))
    put(result, 'endedAt', trace.session.endedAt === undefined ? undefined : iso(trace.session.endedAt))
    if (lanes.length > keep) {
      truncated.push(['lanes'])
    }
    if (truncated.length > 0) {
      result.truncated = truncated
    }
    return redaction.value(result)
  }
  let keep = SUMMARY_LANES
  let result = build(keep)
  while (jsonChars(result) > RESULT_CHARS && keep > 0) {
    keep = Math.floor(keep / 2)
    result = build(keep)
  }
  return result
}

/** Up to `ITEM_IDS` ids, and whether more were left out. */
function someIds(ids: readonly string[], show: TraceIds): { ids: string[]; cut: boolean } {
  return { ids: show.events(ids.slice(0, ITEM_IDS)), cut: ids.length > ITEM_IDS }
}

export interface TurnItem {
  index: number
  /** The user's prompt that starts the turn; absent for events before the first prompt. */
  promptEventId?: string
  prompt?: string
  start: string
  end: string
  firstEventId: string
  lastEventId: string
  events: number
  requests: number
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  failedTools: number
  /** The failed tool results, at most 20. */
  failedToolEventIds: string[]
  /** The compactions in the turn, at most 20. */
  compactionEventIds: string[]
  truncated?: string[][]
}

function promptText(event: TraceEvent | undefined): string | undefined {
  return event?.kind === 'user' ? event.payload.text : undefined
}

function turnItem(
  byId: ReadonlyMap<string, TraceEvent>,
  turn: ReturnType<typeof projectTurns>[number],
  ids: TraceIds,
  redaction: Redaction,
): TurnItem {
  const events = turn.eventIds.map(id => byId.get(id)).filter(event => event !== undefined)
  const failed = someIds(
    events.filter(event => event.kind === 'tool_result' && event.payload.isError === true).map(event => event.id),
    ids,
  )
  const compactions = someIds(
    events.filter(event => event.kind === 'compaction').map(event => event.id),
    ids,
  )
  const truncated: string[][] = []
  const item: TurnItem = {
    index: turn.index,
    start: iso(turn.startTs),
    end: iso(turn.endTs),
    firstEventId: ids.event(turn.eventIds[0]!),
    lastEventId: ids.event(turn.eventIds.at(-1)!),
    events: turn.totals.events,
    requests: turn.totals.requests,
    failedTools: turn.totals.failedTools,
    failedToolEventIds: failed.ids,
    compactionEventIds: compactions.ids,
  }
  if (turn.promptEventId !== undefined) {
    item.promptEventId = ids.event(turn.promptEventId)
    const text = promptText(byId.get(turn.promptEventId))
    if (text !== undefined) {
      const prompt = shown(text, PROMPT_CHARS, redaction)
      item.prompt = prompt.text
      if (prompt.cut) {
        truncated.push(['prompt'])
      }
    }
  }
  put(item, 'inputTokens', turn.totals.inputTokens)
  put(item, 'outputTokens', turn.totals.outputTokens)
  put(item, 'durationMs', turn.totals.durationMs)
  if (failed.cut) {
    truncated.push(['failedToolEventIds'])
  }
  if (compactions.cut) {
    truncated.push(['compactionEventIds'])
  }
  if (truncated.length > 0) {
    item.truncated = truncated
  }
  return item
}

export interface ListPage {
  traceId: string
  total: number
  offset: number
  nextOffset?: number
}

/** Turns in order, one page. Each item is redacted before it is measured. */
export function listTurns(
  trace: Trace,
  traceId: string,
  ids: TraceIds,
  window: { offset?: number; limit?: number },
  redaction: Redaction,
): ListPage & { turns: TurnItem[] } {
  const turns = projectTurns(trace)
  const byId = new Map(trace.events.map(event => [event.id, event]))
  const offset = window.offset ?? 0
  const base = { traceId, total: turns.length, offset }
  const page = pageWithin(
    turns,
    { offset, limit: window.limit ?? 20 },
    turn => redaction.value(turnItem(byId, turn, ids, redaction)),
    jsonChars({ ...base, turns: [], nextOffset: turns.length }),
  )
  const out: ListPage & { turns: TurnItem[] } = { ...base, turns: page.items }
  put(out, 'nextOffset', page.nextOffset)
  return out
}

export interface RequestItem {
  /** The `request` event: reconstruct at this id for what the model saw. */
  id: string
  ts: string
  lane: string
  turn?: number
  model?: string
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  finishReason?: string
  /** What the usage covers when it is not one request: `turn` or `session`. */
  granularity?: string
  /** Events this request produced (its replies and tool calls), at most 20. */
  eventIds: string[]
  eventCount: number
  truncated?: string[][]
}

/** Model requests in order, filtered by lane and turn, one page. */
export function listRequests(
  trace: Trace,
  traceId: string,
  ids: TraceIds,
  query: { lane?: string; turn?: number; offset?: number; limit?: number },
  redaction: Redaction,
): ListPage & { requests: RequestItem[] } {
  let lane: string | undefined
  if (query.lane !== undefined) {
    lane = ids.findLane(query.lane)
    if (lane === undefined) {
      throw new TypeError(`no lane ${query.lane} in ${traceId}; estela_session_summary lists the lanes`)
    }
  }
  const turnOf = new Map<string, number>()
  for (const turn of projectTurns(trace)) {
    for (const id of turn.eventIds) {
      turnOf.set(id, turn.index)
    }
  }
  const events = new Map(trace.events.map(event => [event.id, event]))
  const all = projectRequests(trace).filter(
    request =>
      (lane === undefined || request.agentId === lane)
      && (query.turn === undefined || turnOf.get(request.id) === query.turn),
  )
  const offset = query.offset ?? 0
  const base = { traceId, total: all.length, offset }
  const render = (request: (typeof all)[number]): RequestItem => {
    const members = someIds(request.eventIds, ids)
    const item: RequestItem = {
      id: ids.event(request.id),
      ts: iso(request.ts),
      lane: ids.lane(request.agentId),
      eventIds: members.ids,
      eventCount: request.eventIds.length,
    }
    put(item, 'turn', turnOf.get(request.id))
    put(item, 'model', request.model === undefined ? undefined : shown(request.model, FIELD_CHARS, redaction).text)
    put(item, 'inputTokens', request.inputTokens)
    put(item, 'outputTokens', request.outputTokens)
    put(item, 'durationMs', request.durationMs)
    const event = events.get(request.id)
    if (event?.kind === 'request') {
      const { finishReason, granularity } = event.payload
      put(
        item,
        'finishReason',
        finishReason === undefined ? undefined : shown(finishReason, FIELD_CHARS, redaction).text,
      )
      put(item, 'granularity', granularity === 'request' ? undefined : granularity)
    }
    if (members.cut) {
      item.truncated = [['eventIds']]
    }
    return item
  }
  const page = pageWithin(
    all,
    { offset, limit: query.limit ?? 50 },
    request => redaction.value(render(request)),
    jsonChars({ ...base, requests: [], nextOffset: all.length }),
  )
  const out: ListPage & { requests: RequestItem[] } = { ...base, requests: page.items }
  put(out, 'nextOffset', page.nextOffset)
  return out
}
