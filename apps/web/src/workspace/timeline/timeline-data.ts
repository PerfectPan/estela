import type { Lane } from '@rivus/agent-trace-kernel'
import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { BarInput } from '@/lib/timeline-scale.ts'
import { mainAgentId } from '@rivus/agent-trace-kernel'

export interface Mark {
  ts: number
  id: string
}

export interface CompactionMark extends Mark {
  preTokens?: number
  postTokens?: number
}

/** What one lane draws, from `projectLanes` plus the lane's tool calls and time span. */
export interface LaneDraw {
  lane: Lane
  bars: BarInput[]
  tools: Mark[]
  prompts: Mark[]
  failed: Mark[]
  compactions: CompactionMark[]
  /** First and last event of the lane. */
  from?: number
  to?: number
  spawn?: Mark
}

export interface TimelineData {
  main: LaneDraw
  subs: LaneDraw[]
  start: number
  end: number
  /** Largest recorded input tokens on the main lane; 0 when none is recorded. */
  top: number
}

/** Built once per trace; the SVG only maps it to pixels. */
export function timelineData(
  trace: Trace,
  lanes: readonly Lane[],
  byId: ReadonlyMap<string, TraceEvent>,
): TimelineData {
  const mainId = mainAgentId(trace)
  const draws = new Map<string, LaneDraw>()
  for (const lane of lanes) {
    const draw: LaneDraw = {
      lane,
      bars: lane.requests.map(request => ({
        ts: request.ts,
        id: request.id,
        ...(request.inputTokens !== undefined ? { tokens: request.inputTokens } : {}),
      })),
      tools: [],
      prompts: [],
      failed: [],
      compactions: [],
    }
    for (const marker of lane.markers) {
      if (marker.kind === 'prompt') {
        draw.prompts.push({ ts: marker.ts, id: marker.eventId })
      } else if (marker.kind === 'failed-tool') {
        draw.failed.push({ ts: marker.ts, id: marker.eventId })
      } else {
        draw.compactions.push({
          ts: marker.ts,
          id: marker.eventId,
          preTokens: marker.preTokens,
          postTokens: marker.postTokens,
        })
      }
    }
    draws.set(lane.id, draw)
  }
  let start = Number.POSITIVE_INFINITY
  let end = Number.NEGATIVE_INFINITY
  for (const event of trace.events) {
    if (!Number.isFinite(event.ts) || event.ts <= 0) {
      continue
    }
    start = Math.min(start, event.ts)
    end = Math.max(end, event.ts)
    const draw = draws.get(event.agentId ?? mainId)
    if (!draw) {
      continue
    }
    draw.from = Math.min(draw.from ?? event.ts, event.ts)
    draw.to = Math.max(draw.to ?? event.ts, event.ts)
    if (event.kind === 'tool_call') {
      draw.tools.push({ ts: event.ts, id: event.id })
    }
  }
  if (!Number.isFinite(start)) {
    start = trace.session.startedAt ?? 0
    end = start
  }
  for (const draw of draws.values()) {
    const spawn = draw.lane.spawnEventId
    const ts = spawn ? byId.get(spawn)?.ts : undefined
    if (spawn && ts !== undefined) {
      draw.spawn = { ts, id: spawn }
    }
  }
  const main = draws.get(mainId) ?? draws.values().next().value!
  const top = main.bars.reduce((max, bar) => Math.max(max, bar.tokens ?? 0), 0)
  return {
    main,
    subs: lanes.filter(lane => lane.id !== main.lane.id).map(lane => draws.get(lane.id)!),
    start,
    end,
    top,
  }
}
