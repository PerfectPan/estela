import type { VirtualRow } from '@/lib/ledger-model.ts'
import type { WorkspaceState } from '../workspace-state.ts'
import type { RowContext } from './row-frame.tsx'
import { Match, Switch } from 'solid-js'
import { CompactionRow } from './compaction-row.tsx'
import { HooksRow } from './hooks-row.tsx'
import { SubagentRow } from './subagent-row.tsx'
import { EventRow } from './event-row.tsx'

export function LedgerEntryBody(props: {
  row: Extract<VirtualRow, { type: 'entry' }>
  ctx: RowContext
  state: WorkspaceState
}) {
  const entry = () => props.row.entry
  // Each accessor narrows the entry union to one variant, so `Match` hands the row its typed entry.
  const event = () => {
    const current = entry()
    return current.type === 'event' ? current : undefined
  }
  const subagent = () => {
    const current = entry()
    return current.type === 'subagent' ? current : undefined
  }
  const hooks = () => {
    const current = entry()
    return current.type === 'hooks' ? current : undefined
  }
  const compaction = () => {
    const current = entry()
    return current.type === 'compaction' ? current : undefined
  }
  return (
    <Switch>
      <Match when={event()}>
        {current => <EventRow entry={current()} depth={props.row.depth} ctx={props.ctx} lane={props.row.lane} />}
      </Match>
      <Match when={subagent()}>
        {current => (
          <SubagentRow
            entry={current()}
            expanded={props.row.expanded}
            ctx={props.ctx}
            onToggle={() => props.state.toggleEntry(current().id)}
          />
        )}
      </Match>
      <Match when={hooks()}>{current => <HooksRow entry={current()} depth={props.row.depth} />}</Match>
      <Match when={compaction()}>{current => <CompactionRow entry={current()} ctx={props.ctx} />}</Match>
    </Switch>
  )
}
