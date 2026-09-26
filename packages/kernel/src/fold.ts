import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'

export interface TraceFold {
  /** True when any event has `parentId`. */
  hasTree: boolean
  /** True when any event is shadowed. */
  hasShadowing: boolean
  /** Root-timeline events (no parentId), in log order. */
  roots: TraceEvent[]
}

export function fold(trace: Trace): TraceFold {
  return {
    hasTree: trace.events.some(e => e.parentId != null),
    hasShadowing: trace.events.some(e => e.shadowedBy != null),
    roots: trace.events.filter(e => e.parentId == null),
  }
}
