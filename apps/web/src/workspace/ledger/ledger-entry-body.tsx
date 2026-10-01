import type { Entry, VirtualRow } from '@/lib/ledger-model.ts'
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
  return (
    <Switch>
      <Match when={entry().type === 'event' ? (entry() as Extract<Entry, { type: 'event' }>) : undefined}>
        {current => <EventRow entry={current()} depth={props.row.depth} ctx={props.ctx} lane={props.row.lane} />}
      </Match>
      <Match when={entry().type === 'subagent' ? (entry() as Extract<Entry, { type: 'subagent' }>) : undefined}>
        {current => (
          <SubagentRow
            entry={current()}
            expanded={props.row.expanded}
            ctx={props.ctx}
            onToggle={() => props.state.toggleEntry(current().id)}
          />
        )}
      </Match>
      <Match when={entry().type === 'hooks' ? (entry() as Extract<Entry, { type: 'hooks' }>) : undefined}>
        {current => <HooksRow entry={current()} depth={props.row.depth} />}
      </Match>
      <Match when={entry().type === 'compaction' ? (entry() as Extract<Entry, { type: 'compaction' }>) : undefined}>
        {current => <CompactionRow entry={current()} ctx={props.ctx} />}
      </Match>
    </Switch>
  )
}
