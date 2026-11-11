/** The lane layout's rows, split from the turn layout's (`ledger-model.ts`) to keep both under budget. */

import { mainAgentId } from '@rivus/agent-trace-kernel'
import {
  ROW_SIZE,
  pushEntry,
  entryEventIds,
  type Entry,
  type LedgerModel,
  type LedgerView,
  type VirtualRow,
} from './ledger-model.ts'

/** Keep the turn model's hook groups intact when moving entries onto their own lanes. */
function entriesByLane(model: LedgerModel): Map<string, Entry[]> {
  const lanes = new Map<string, Entry[]>()
  const mainId = mainAgentId(model.trace)
  const add = (entry: Entry): void => {
    if (entry.type === 'subagent') {
      if (entry.eventId) {
        const spawn = model.entries.get(`e:${entry.eventId}`)
        if (spawn) {
          add(spawn)
        }
      }
      entry.children.forEach(add)
      return
    }
    const event = model.byId.get(entryEventIds(entry)[0]!)
    const laneId = event?.agentId ?? mainId
    const entries = lanes.get(laneId) ?? []
    entries.push(entry)
    lanes.set(laneId, entries)
  }
  model.turns.forEach(turn => turn.entries.forEach(add))
  return lanes
}

/**
 * The rows the lane layout draws: one header per agent lane (`projectLanes` order, the main lane
 * first), then the lane's own events flat — no subagent nesting, since each agent already has its
 * lane. Entries come from the same map the turn layout built, so both layouts draw one event with
 * one id, and the chip and range rules are `entryMatches` either way. A lane with no passing entry
 * is left out while a filter or range is active. The collapse keys are `l:<lane id>`, disjoint
 * from the turn layout's `t<index>`.
 */
export function flattenLanes(model: LedgerModel, view: LedgerView): VirtualRow[] {
  const out: VirtualRow[] = []
  const filtering = view.filter !== 'all' || view.range !== undefined
  const entries = entriesByLane(model)
  for (const lane of model.lanes) {
    const rows: VirtualRow[] = []
    for (const entry of entries.get(lane.id) ?? []) {
      pushEntry(rows, entry, 0, false, model, view)
    }
    if (filtering && rows.length === 0) {
      continue
    }
    const key = `l:${lane.id}`
    const collapsed = view.collapsed.has(key)
    out.push({
      key,
      type: 'lane',
      laneId: lane.id,
      title: lane.title,
      collapsed,
      requests: lane.requests.length,
      size: ROW_SIZE.turn,
    })
    if (!collapsed) {
      for (const row of rows) {
        out.push(row)
      }
    }
  }
  return out
}
