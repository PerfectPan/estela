import { Show } from 'solid-js'
import { ChevronDownIcon, ChevronRightIcon } from '@/components/icons.tsx'
import { agentName } from '@/lib/agent-names.ts'
import { locale, plural } from '@/i18n/locale.ts'
import { formatNumber } from '@/lib/format.ts'
import type { VirtualRow } from '@/lib/ledger-model.ts'
import { AgentMark } from '@/browser/agent-mark.tsx'
import type { RowContext } from './row-frame.tsx'

/** 40 px lane header: chevron, the agent's mark and name, and the count of the rows it draws. */
export function LaneHeader(props: {
  row: Extract<VirtualRow, { type: 'lane' }>
  collapsed: boolean
  ctx: RowContext
  onToggle: () => void
}) {
  return (
    <div class="flex h-full items-center gap-2.5 border-b border-border bg-secondary pr-4 pl-[18px]">
      <button
        type="button"
        tabindex="-1"
        class="grid size-[15px] shrink-0 place-items-center text-muted-foreground"
        aria-hidden="true"
        onClick={event => {
          event.stopPropagation()
          props.onToggle()
        }}
      >
        {props.collapsed ? <ChevronRightIcon size={15} /> : <ChevronDownIcon size={15} />}
      </button>
      <AgentMark id={props.row.laneId} />
      <span class="min-w-0 flex-1 truncate text-[13px] font-semibold whitespace-nowrap text-foreground">
        {props.row.title ?? agentName(props.row.laneId)}
      </span>
      <Show when={props.row.count > 0}>
        <span class="shrink-0 text-[12px] text-muted-foreground">
          {plural(
            props.row.count,
            'ledger.eventCountOne',
            'ledger.eventCount',
            formatNumber(props.row.count, locale()),
          )}
        </span>
      </Show>
    </div>
  )
}
