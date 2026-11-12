import type { Lane } from '@rivus/agent-kit/transcript'
import type { EventOf, Trace, TraceEvent } from '@rivus/estela-schema'
import { laneOf, mainAgentId, promptStarts, requestUsage } from './lanes.ts'

/** One model request, for timeline bars. Numbers are `undefined` when the agent did not record them. */
export interface RequestEntry {
  id: string
  seq: number
  ts: number
  /** Lane id; the main agent when the event has no `agentId`. */
  agentId: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  /** Other events with this request's `requestId`, in order. */
  eventIds: string[]
}

export type LaneMarker =
  | { kind: 'prompt'; eventId: string; ts: number }
  | { kind: 'failed-tool'; eventId: string; ts: number; callId?: string; name?: string }
  | { kind: 'compaction'; eventId: string; ts: number; trigger?: string; preTokens?: number; postTokens?: number }

/** A lane as the timeline draws it: the trace's `Lane` fields it shows, plus its depth, requests, and markers. */
export interface TimelineLane {
  id: string
  parentId?: string
  spawnEventId?: string
  title?: string
  /** 0 for the main lane, 1 for its subagents, and so on. */
  depth: number
  requests: RequestEntry[]
  /** Prompt, failed-tool, and compaction markers in event order. */
  markers: LaneMarker[]
}

function requestEntry(event: EventOf<'request'>, lane: string, members: string[]): RequestEntry {
  const entry: RequestEntry = { id: event.id, seq: event.seq, ts: event.ts, agentId: lane, eventIds: members }
  const { model, durationMs } = event.payload
  if (model !== undefined) {
    entry.model = model
  }
  Object.assign(entry, requestUsage(event))
  if (durationMs !== undefined) {
    entry.durationMs = durationMs
  }
  return entry
}

/** One entry per `request` event, in trace order. */
export function projectRequests(trace: Trace): RequestEntry[] {
  const mainId = mainAgentId(trace)
  const members = new Map<string, string[]>()
  for (const event of trace.events) {
    if (event.requestId == null || event.kind === 'request') {
      continue
    }
    const list = members.get(event.requestId)
    if (list) {
      list.push(event.id)
    } else {
      members.set(event.requestId, [event.id])
    }
  }
  return trace.events
    .filter(event => event.kind === 'request')
    .map(event =>
      requestEntry(event, laneOf(event, mainId), event.requestId ? (members.get(event.requestId) ?? []) : []),
    )
}

function toolNames(trace: Trace): Map<string, string> {
  const names = new Map<string, string>()
  for (const event of trace.events) {
    if (event.kind !== 'tool_call') {
      continue
    }
    const { callId, name } = event.payload
    if (callId && name) {
      names.set(callId, name)
    }
  }
  return names
}

function marker(event: TraceEvent, prompts: Set<string>, names: Map<string, string>): LaneMarker | undefined {
  if (prompts.has(event.id)) {
    return { kind: 'prompt', eventId: event.id, ts: event.ts }
  }
  if (event.kind === 'tool_result' && event.payload.isError === true) {
    const out: LaneMarker = { kind: 'failed-tool', eventId: event.id, ts: event.ts }
    const callId = event.payload.callId
    if (callId) {
      out.callId = callId
      const name = names.get(callId)
      if (name) {
        out.name = name
      }
    }
    return out
  }
  if (event.kind === 'compaction') {
    const out: LaneMarker = { kind: 'compaction', eventId: event.id, ts: event.ts }
    const { trigger, preTokens, postTokens } = event.payload
    if (trigger) {
      out.trigger = trigger
    }
    if (preTokens !== undefined) {
      out.preTokens = preTokens
    }
    if (postTokens !== undefined) {
      out.postTokens = postTokens
    }
    return out
  }
  return undefined
}

function depthOf(id: string, parents: Map<string, string | undefined>): number {
  let depth = 0
  let cursor = parents.get(id)
  const seen = new Set([id])
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    depth += 1
    cursor = parents.get(cursor)
  }
  return depth
}

/**
 * The main lane, then one lane per subagent in `agents[]` order, then any lane
 * that only appears on events. Each lane carries its requests and markers.
 */
export function projectLanes(trace: Trace): TimelineLane[] {
  const mainId = mainAgentId(trace)
  const lanes = new Map<string, TimelineLane>()
  const parents = new Map<string, string | undefined>()
  const add = (id: string, info?: Lane): void => {
    if (lanes.has(id)) {
      return
    }
    const lane: TimelineLane = { id, depth: 0, requests: [], markers: [] }
    if (info?.parentId) {
      lane.parentId = info.parentId
    }
    if (info?.spawnEventId) {
      lane.spawnEventId = info.spawnEventId
    }
    if (info?.title) {
      lane.title = info.title
    }
    lanes.set(id, lane)
    parents.set(id, id === mainId ? undefined : (info?.parentId ?? mainId))
  }
  add(
    mainId,
    trace.agents.find(agent => agent.id === mainId),
  )
  for (const agent of trace.agents) {
    add(agent.id, agent)
  }
  for (const event of trace.events) {
    add(laneOf(event, mainId))
  }

  for (const request of projectRequests(trace)) {
    lanes.get(request.agentId)!.requests.push(request)
  }
  const prompts = new Set(promptStarts(trace).map(event => event.id))
  const names = toolNames(trace)
  for (const event of trace.events) {
    const found = marker(event, prompts, names)
    if (found) {
      lanes.get(laneOf(event, mainId))!.markers.push(found)
    }
  }
  for (const lane of lanes.values()) {
    lane.depth = depthOf(lane.id, parents)
  }
  return [...lanes.values()]
}
