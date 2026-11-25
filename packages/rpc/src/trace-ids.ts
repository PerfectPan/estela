import type { ReconstructResult, Trace, TraceEvent } from '@rivus/estela-schema'
import { mainAgentId } from '@rivus/estela-kernel'
import type { TraceRedaction } from './trace-store-types.ts'

/**
 * A recorded id shown as written: letters, digits, `_`, `.`, `:`, and `-`, at most 128 characters,
 * and unchanged by redaction. No such id can start with `@`, so an alias never names a recorded id.
 */
const SAFE_ID = /^[\w.:-]{1,128}$/

/**
 * Event and lane ids as a redacting reader shows them. Ids are written by whatever wrote the log (Claude Code's `uuid`,
 * a subagent's id) and come back as input, so they cannot be clipped or redacted like other text. An id that is not
 * safe to show (too long, other characters, or one redaction would change) is shown as an alias instead: `@e<seq>` for
 * the event at that index, `@l<n>` for the lane at that position. Readers accept both forms. An id is resolved and
 * shown once, at the boundary that sends it out: the TraceStore for everything the browser, a report source, and
 * `estela_get_event` read, the other agent tools for the traces they read unshown.
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

  /** A field that names an event (`parentId`, `shadowedBy`): as `event` shows it. An id no event has, such as a
   * record that became no event, is left as recorded for the text redaction of everything else. */
  reference(id: string): string {
    if (this.eventIndex.has(id)) {
      return this.event(id)
    }
    // No event has this id: it must not read as an alias that names one.
    return /^@e\d+$/.test(id) ? '@e?' : id
  }

  /** A field that names a lane (`agents[].parentId`): as `lane` shows it; left as recorded when no lane has that id. */
  laneReference(id: string): string {
    if (this.laneIndex.has(id)) {
      return this.lane(id)
    }
    return /^@l\d+$/.test(id) ? '@l?' : id
  }

  lane(id: string): string {
    if (this.safe(id)) {
      return id
    }
    const index = this.laneIndex.get(id)
    return index === undefined ? '@l?' : `@l${index}`
  }

  /** Whether `id` has a form `event` gives out: `@e<seq>`, or `@e?` for an id no event has. */
  isShown(id: string): boolean {
    return /^@e\d+$/.test(id) || id === '@e?'
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

  /**
   * `trace` with every event and lane id shown as `event` and `lane` show them, so the references between events
   * still meet after redaction. `requestId` groups the events of one model request; it is not the id of an event,
   * and the text redaction handles it as any other string.
   */
  shown(trace: Trace): Trace {
    return {
      ...trace,
      agents: trace.agents.map(lane => ({
        ...lane,
        id: this.laneReference(lane.id),
        ...(lane.parentId === undefined ? {} : { parentId: this.laneReference(lane.parentId) }),
        ...(lane.spawnEventId === undefined ? {} : { spawnEventId: this.reference(lane.spawnEventId) }),
      })),
      events: trace.events.map(event => this.eventShown(event)),
    }
  }

  /** One event (a view event, `get-event`'s result) with its ids shown the same way. */
  eventShown(event: TraceEvent): TraceEvent {
    const shown = {
      id: this.event(event.id),
      ...(event.agentId === undefined ? {} : { agentId: this.lane(event.agentId) }),
      ...(event.parentId === undefined ? {} : { parentId: this.reference(event.parentId) }),
      ...(event.shadowedBy === undefined ? {} : { shadowedBy: this.reference(event.shadowedBy) }),
    }
    if (event.kind === 'compaction' && event.payload.summaryEventId !== undefined) {
      return {
        ...event,
        ...shown,
        payload: { ...event.payload, summaryEventId: this.reference(event.payload.summaryEventId) },
      }
    }
    if (event.kind === 'system') {
      const { systemPromptSameAs, toolsSameAs, ...rest } = event.payload
      return {
        ...event,
        ...shown,
        payload: {
          ...rest,
          ...(systemPromptSameAs === undefined ? {} : { systemPromptSameAs: this.reference(systemPromptSameAs) }),
          ...(toolsSameAs === undefined ? {} : { toolsSameAs: this.reference(toolsSameAs) }),
        },
      }
    }
    return { ...event, ...shown }
  }

  /** A reconstruction's result (`reconstruct`) with its event ids shown the same way. */
  surface(result: ReconstructResult): ReconstructResult {
    return {
      ...result,
      eventId: this.event(result.eventId),
      slots: (result.slots ?? []).map(slot => ({
        ...slot,
        eventIds: this.events(slot.eventIds),
        ...(slot.recordedBy === undefined ? {} : { recordedBy: this.reference(slot.recordedBy) }),
      })),
      visibleIds: this.events(result.visibleIds),
      ...(result.removedIds === undefined ? {} : { removedIds: this.events(result.removedIds) }),
    }
  }
}

/**
 * The `TraceIds` of each loaded trace a reader sends, built once per trace and redaction: the reader's own, or
 * one a caller names. Without a redaction there are none: ids are sent as recorded and looked up as recorded.
 */
export class TraceIdMaps {
  private readonly maps = new Map<TraceRedaction | undefined, WeakMap<Trace, TraceIds>>()

  of(trace: Trace, redact: TraceRedaction | undefined): TraceIds | undefined {
    if (!redact) {
      return undefined
    }
    let traces = this.maps.get(redact)
    if (!traces) {
      traces = new WeakMap<Trace, TraceIds>()
      this.maps.set(redact, traces)
    }
    let ids = traces.get(trace)
    if (!ids) {
      ids = new TraceIds(trace, id => redact.text(id) === id)
      traces.set(trace, ids)
    }
    return ids
  }
}
