/** The lane layout's rows, split from the turn layout's (`ledger-model.ts`) to keep both under budget. */

import { foldHookRuns, mainAgentId } from '@rivus/agent-trace-kernel'
import { ROW_SIZE, pushEntry, type LedgerModel, type LedgerView, type VirtualRow } from './ledger-model.ts'

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
  const mainId = mainAgentId(model.trace)
  for (const lane of model.lanes) {
    const rows: VirtualRow[] = []
    const events = model.trace.events.filter(event => (event.agentId ?? mainId) === lane.id)
    for (const row of foldHookRuns(events)) {
      const key = row.type === 'hooks' ? `h:${row.eventIds[0]}` : `e:${row.eventId}`
      const entry = model.entries.get(key)
      if (entry) {
        pushEntry(rows, entry, 0, false, model, view)
      }
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
      count: rows.length,
      size: ROW_SIZE.turn,
    })
    if (!collapsed) {
      out.push(...rows)
    }
  }
  return out
}
