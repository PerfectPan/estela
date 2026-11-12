import type { LedgerFilter, LedgerLayout, LedgerModel } from '@/lib/ledger-model.ts'
import type { TimeRange } from '@/lib/timeline-scale.ts'
import type { InspectorTab } from './inspector/inspector-tab.ts'
import type { LoadedSession } from './load-session.ts'
import { batch, createMemo, createSignal } from 'solid-js'
import { flattenLanes } from '@/lib/ledger-lanes.ts'
import {
  buildLedgerModel,
  countEvents,
  entryEventIds,
  entryMatches,
  flattenLedger,
  isFailedResult,
} from '@/lib/ledger-model.ts'
import { costOfEvents, mainAgentId, priceTrace, snapshotPricing } from '@rivus/estela-kernel'
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
  // List prices of the recorded usage, from the kit's LiteLLM snapshot bundled through the kernel: the same
  // numbers on the dev server and in a report, which has no server to ask.
  const cost = priceTrace(session.trace, snapshotPricing())
  const turnCosts = new Map(model.turns.map(group => [group.id, costOfEvents(cost, group.turn.eventIds)]))
  const [filter, setFilter] = createSignal<LedgerFilter>('all')
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(new Set())
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [range, setRange] = createSignal<TimeRange>()
  const [dim, setDim] = createSignal(false)
  const [layout, writeLayout] = createSignal<LedgerLayout>('turns')
  /** Key of the selected ledger row (an entry id, a turn id, or a lane id). */
  const [selectedKey, setSelectedKey] = createSignal<string>()
  const [tab, setTab] = createSignal<InspectorTab>('input')
  /** The request the user picked to compare the selected one with; used while it stays on the selected lane. */
  const [comparePick, setComparePick] = createSignal<string>()

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

  /** A spawn is a subagent header in Turns and an ordinary tool-call row in Agents. */
  function selectionFor(eventId: string): string | undefined {
    const place = model.locate.get(eventId)
    const entry = place ? model.entries.get(place.entryId) : undefined
    return layout() === 'lanes' && entry?.type === 'subagent' && entry.eventId ? `e:${entry.eventId}` : place?.entryId
  }

  /** Open ancestors only: a selected hook group keeps its own folded state. */
  function openContainers(eventId: string, key: string | undefined): void {
    const place = model.locate.get(eventId)
    if (!place) {
      return
    }
    const laneId = model.byId.get(eventId)?.agentId ?? mainAgentId(model.trace)
    const closed = new Set(collapsed())
    closed.delete(place.turnId)
    closed.delete(`l:${laneId}`)
    setCollapsed(closed)
    const open = new Set(expanded())
    for (const parent of place.parents) {
      if (parent !== key) {
        open.add(parent)
      }
    }
    setExpanded(open)
  }

  /** Preserve the selected event when its containing row changes between layouts. */
  function setLayout(next: LedgerLayout): void {
    if (next === layout()) {
      return
    }
    const entry = selectedEntry()
    // A subagent lane's header stands for its spawn call, which Turns draws as the subagent row. A lane
    // that only its events name has no spawn call to stand for, so it keeps no selection, as do the main
    // lane's header and the turn headers, which have no row in the other layout.
    const eventId = selectedEventId() ?? model.lanes.find(lane => `l:${lane.id}` === selectedKey())?.spawnEventId
    batch(() => {
      writeLayout(next)
      let key = entry?.type === 'hooks' ? entry.id : eventId ? selectionFor(eventId) : undefined
      if (eventId) {
        openContainers(eventId, key)
      }
      // A Requests chip can keep the child lane while excluding its spawn tool call.
      if (next === 'lanes' && entry?.type === 'subagent' && !rows().some(row => row.key === key)) {
        const laneKey = `l:${entry.laneId}`
        if (rows().some(row => row.key === laneKey)) {
          key = laneKey
        }
      }
      setSelectedKey(key)
    })
  }

  /** Select an event from outside the ledger (a timeline bar): open what hides it, and drop filters that exclude it. */
  function reveal(eventId: string): void {
    const place = model.locate.get(eventId)
    if (!place) {
      return
    }
    batch(() => {
      const key = selectionFor(eventId)
      openContainers(eventId, key)
      const entry = key ? model.entries.get(key) : undefined
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
      setSelectedKey(key)
    })
  }

  /** Compare the selected request with `eventId` (a timeline Shift-click or a quick pick) and show the diff. */
  function compareWith(eventId: string | undefined): void {
    batch(() => {
      setComparePick(eventId)
      setTab('compare')
    })
  }

  return {
    session,
    model,
    timeline,
    cost,
    turnCosts,
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
    toggleLane: (id: string) => setCollapsed(toggled(collapsed(), `l:${id}`)),
    expanded,
    toggleEntry: (id: string) => setExpanded(toggled(expanded(), id)),
    selectedKey,
    setSelectedKey,
    selectedEntry,
    selectedEventId,
    reveal,
    tab,
    setTab,
    comparePick,
    compareWith,
  }
}

export type WorkspaceState = ReturnType<typeof createWorkspaceState>
