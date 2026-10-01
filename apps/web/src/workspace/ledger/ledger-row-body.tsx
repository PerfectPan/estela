import type { VirtualRow } from '@/lib/ledger-model.ts'
import type { WorkspaceState } from '../workspace-state.ts'
import type { RowContext } from './row-frame.tsx'
import { Match, Switch } from 'solid-js'
import { TurnHeader } from './turn-header.tsx'
import { LedgerEntryBody } from './ledger-entry-body.tsx'

export function LedgerRowBody(props: {
  row: VirtualRow
  ctx: RowContext
  number: (index: number, hasPrompt: boolean) => number | undefined
  state: WorkspaceState
}) {
  const turn = () => (props.row.type === 'turn' ? props.row : undefined)
  const entry = () => (props.row.type === 'entry' ? props.row : undefined)
  return (
    <Switch>
      <Match when={turn()}>
        {row => (
          <TurnHeader
            group={row().group}
            number={props.number(row().group.turn.index, row().group.turn.promptEventId !== undefined)}
            collapsed={row().collapsed}
            ctx={props.ctx}
            onToggle={() => props.state.toggleTurn(row().group.id)}
          />
        )}
      </Match>
      <Match when={entry()}>{row => <LedgerEntryBody row={row()} ctx={props.ctx} state={props.state} />}</Match>
    </Switch>
  )
}
