import type { Trace } from '@rivus/estela-schema'
import { mainAgentId } from '@rivus/estela-kernel'

/**
 * A recorded id an agent tool returns as written: letters, digits, `_`, `.`, `:`, and `-`, at most 128 characters,
 * and unchanged by redaction. No such id can start with `@`, so an alias never names a recorded id.
 */
const SAFE_ID = /^[\w.:-]{1,128}$/

/**
 * Event and lane ids as the agent tools show them. Ids are written by whatever wrote the log (Claude Code's `uuid`,
 * a subagent's id) and come back to the tools as input, so a tool cannot clip or redact them like other text. An id
 * that is not safe to show (too long, other characters, or one redaction would change) is shown as an alias instead:
 * `@e<seq>` for the event at that index, `@l<n>` for the lane at that position. The tools accept both forms.
 */
export class TraceIds {
  private readonly trace: Trace
  private readonly safe: (id: string) => boolean
  private readonly eventIndex = new Map<string, number>()
  private readonly laneIndex = new Map<string, number>()
  private readonly lanes: string[]

  /** `unchanged(id)` is true when redaction leaves `id` as it is. */
  constructor(trace: Trace, unchanged: (id: string) => boolean) {
    this.trace = trace
    this.safe = id => SAFE_ID.test(id) && unchanged(id)
    // The last event with an id wins, as in the TraceStore's lookup, so an alias and `get-event` name the same event.
    trace.events.forEach((event, index) => this.eventIndex.set(event.id, index))
    const mainId = mainAgentId(trace)
    const lanes = new Set([mainId, ...trace.agents.map(agent => agent.id)])
    for (const event of trace.events) {
      lanes.add(event.agentId ?? mainId)
    }
    this.lanes = [...lanes]
    this.lanes.forEach((id, index) => this.laneIndex.set(id, index))
  }

  /** How an event id is shown. An id no event has is shown only when it is safe, else as `@e?`. */
  event(id: string): string {
    if (this.safe(id)) {
      return id
    }
    const index = this.eventIndex.get(id)
    return index === undefined ? '@e?' : `@e${index}`
  }

  events(ids: readonly string[]): string[] {
    return ids.map(id => this.event(id))
  }

  lane(id: string): string {
    if (this.safe(id)) {
      return id
    }
    const index = this.laneIndex.get(id)
    return index === undefined ? '@l?' : `@l${index}`
  }

  /** The recorded event id a shown id (an id as written, or an alias) names; `undefined` when none. */
  findEvent(shown: string): string | undefined {
    const alias = /^@e(\d+)$/.exec(shown)
    if (alias) {
      // Only the alias `event` gives out: with duplicate ids, an earlier event's index names no event.
      const id = this.trace.events[Number(alias[1])]?.id
      return id !== undefined && this.eventIndex.get(id) === Number(alias[1]) ? id : undefined
    }
    return this.eventIndex.has(shown) && this.safe(shown) ? shown : undefined
  }

  /** The recorded lane id a shown lane id names; `undefined` when none. */
  findLane(shown: string): string | undefined {
    const alias = /^@l(\d+)$/.exec(shown)
    if (alias) {
      return this.lanes[Number(alias[1])]
    }
    return this.laneIndex.has(shown) && this.safe(shown) ? shown : undefined
  }
}
