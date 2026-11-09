import type { LedgerFilter, LedgerLayout, LedgerModel } from '@/lib/ledger-model.ts'
import type { TimeRange } from '@/lib/timeline-scale.ts'
import type { LoadedSession } from './load-session.ts'
import { batch, createMemo, createSignal } from 'solid-js'
import {
  buildLedgerModel,
  countEvents,
  entryEventIds,
  entryMatches,
  flattenLanes,
  flattenLedger,
  isFailedResult,
} from '@/lib/ledger-model.ts'
import { mainAgentId } from '@rivus/agent-trace-kernel'
import { timelineData } from './timeline/timeline-data.ts'

function toggled(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return next
}

/** All workspace UI state over one loaded session: filters, range, collapse, selection. */
export function createWorkspaceState(session: LoadedSession) {
  const model: LedgerModel = buildLedgerModel(session.trace)
  const timeline = timelineData(session.trace, model.lanes, model.byId)
  const [filter, setFilter] = createSignal<LedgerFilter>('all')
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [range, setRange] = createSignal<TimeRange>()
  const [dim, setDim] = createSignal(false)
  const [layout, setLayout] = createSignal<LedgerLayout>('turns')
  /** Key of the selected ledger row (an entry id, a turn id, or a lane id). */
  const [selectedKey, setSelectedKey] = createSignal<string>()

  const rows = createMemo(() => {
    const view = {
      collapsed: collapsed(),
      expanded: expanded(),
      filter: filter(),
      range: range(),
    }
    return layout() === 'lanes' ? flattenLanes(model, view) : flattenLedger(model, view)
  })
  const eventCount = createMemo(() => countEvents(session.trace, range()))
  // The header's number (fold) and the chip use one rule: every failed tool result.
  const failures = session.summary.failedTools ?? session.trace.events.filter(isFailedResult).length
  const selectedEntry = createMemo(() => {
    const key = selectedKey()
    return key ? model.entries.get(key) : undefined
  })
  const selectedEventId = createMemo(() => {
    const entry = selectedEntry()
    return entry ? entryEventIds(entry)[0] : undefined
  })

  /** Select an event from outside the ledger (a timeline bar): open what hides it, and drop filters that exclude it. */
  function reveal(eventId: string): void {
    const place = model.locate.get(eventId)
    if (!place) {
      return
    }
    batch(() => {
      if (collapsed().has(place.turnId)) {
        setCollapsed(toggled(collapsed(), place.turnId))
      }
      // The lane layout collapses by `l:<agent>`: open the event's lane the same way.
      const laneId = model.byId.get(eventId)?.agentId ?? mainAgentId(model.trace)
      if (collapsed().has(`l:${laneId}`)) {
        setCollapsed(toggled(collapsed(), `l:${laneId}`))
      }
      const open = new Set(expanded())
      for (const parent of place.parents) {
        open.add(parent)
      }
      setExpanded(open)
      const entry = model.entries.get(place.entryId)
      if (
        entry
        && !entryMatches(entry, model, {
          collapsed: collapsed(),
          expanded: expanded(),
          filter: filter(),
          range: range(),
        })
      ) {
        setFilter('all')
        setRange(undefined)
      }
      setSelectedKey(place.entryId)
    })
  }

  return {
    session,
    model,
    timeline,
    rows,
    eventCount,
    failures,
    filter,
    setFilter,
    range,
    setRange,
    dim,
    setDim,
    layout,
    setLayout,
    collapsed,
    toggleTurn: (id: string) => setCollapsed(toggled(collapsed(), id)),
    toggleLane: (id: string) => setCollapsed(toggled(collapsed(), id)),
    expanded,
    toggleEntry: (id: string) => setExpanded(toggled(expanded(), id)),
    selectedKey,
    setSelectedKey,
    selectedEntry,
    selectedEventId,
    reveal,
  }
}

export type WorkspaceState = ReturnType<typeof createWorkspaceState>
