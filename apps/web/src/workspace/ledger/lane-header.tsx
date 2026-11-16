import { mainAgentId } from '@rivus/estela-kernel'
import { CollapseChevron } from './collapse-chevron.tsx'
import { locale, plural, translate as t } from '@/i18n/locale.ts'
import { costBasisText, costShort } from '@/lib/cost-text.ts'
import { formatNumber } from '@/lib/format.ts'
import type { VirtualRow } from '@/lib/ledger-model.ts'
import { escapeBidi } from '@/lib/preview.ts'
import type { RowContext } from './row-frame.tsx'

/** 40 px lane header: chevron, the agent's title, and the lane's requests, counted like a turn header's. */
export function LaneHeader(props: {
  row: Extract<VirtualRow, { type: 'lane' }>
  collapsed: boolean
  ctx: RowContext
  onToggle: () => void
}) {
  const cost = () => props.ctx.cost.lanes.get(props.row.laneId)
  const title = () => {
    const { title, laneId } = props.row
    if (title === undefined && laneId === mainAgentId(props.ctx.model.trace)) {
      return t('timeline.mainAgent')
    }
    return escapeBidi(title ?? laneId)
  }
  return (
    <div class="flex h-full items-center gap-2.5 border-b border-border bg-secondary pr-4 pl-[18px]">
      <CollapseChevron collapsed={props.collapsed} onToggle={props.onToggle} />
      <span
        class="min-w-0 flex-1 truncate text-[13px] font-semibold whitespace-nowrap text-foreground [unicode-bidi:isolate]"
        dir="auto"
      >
        {title()}
      </span>
      <span
        class="shrink-0 font-mono text-[11.5px] text-subtle"
        title={cost() ? costBasisText(props.ctx.cost.version) : undefined}
        data-testid="lane-totals"
      >
        {[
          plural(
            props.row.requests,
            'ledger.requestCountOne',
            'ledger.requestCount',
            formatNumber(props.row.requests, locale()),
          ),
          cost() ? costShort(cost()!) : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </div>
  )
}
