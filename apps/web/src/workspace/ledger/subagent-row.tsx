import type { Entry } from '@/lib/ledger-model.ts'
import { locale, plural, translate as t } from '@/i18n/locale.ts'
import { toolTarget } from '@/lib/event-text.ts'
import { formatDuration, formatNumber } from '@/lib/format.ts'
import type { RowContext } from './ledger-rows.tsx'
import { RowFrame, elapsed } from './ledger-rows.tsx'

export function SubagentRow(props: {
  entry: Extract<Entry, { type: 'subagent' }>
  expanded: boolean
  ctx: RowContext
  onToggle: () => void
}) {
  const spawn = () => (props.entry.eventId ? props.ctx.model.byId.get(props.entry.eventId) : undefined)
  const events = () =>
    props.entry.children.flatMap(child => (child.type === 'event' ? [props.ctx.model.byId.get(child.eventId)!] : []))
  const metric = () => {
    const list = events()
    const requests = list.filter(event => event.kind === 'request').length
    const span = list.length > 1 ? list.at(-1)!.ts - list[0]!.ts : 0
    const count =
      requests > 0
        ? plural(requests, 'ledger.requestCountOne', 'ledger.requestCount', formatNumber(requests, locale()))
        : plural(list.length, 'ledger.eventCountOne', 'ledger.eventCount', formatNumber(list.length, locale()))
    return [count, span > 0 ? formatDuration(span, locale()) : ''].filter(Boolean).join(' · ')
  }
  const prompt = () => {
    const call = spawn()
    const target = call ? toolTarget(call.payload.args) : ''
    return target ? `“${target}”` : ''
  }
  const title = () => props.entry.title ?? props.entry.laneId
  return (
    <RowFrame
      ordinal={props.entry.ordinal}
      kind="subagent"
      depth={0}
      dimmed={props.ctx.dim && props.entry.eventId !== undefined && props.ctx.model.hidden.has(props.entry.eventId)}
      metric={metric()}
      time={elapsed(spawn()?.ts ?? events()[0]?.ts, props.ctx)}
    >
      <span>{[title(), prompt()].filter(Boolean).join(' · ')}</span>
      <button
        type="button"
        tabindex="-1"
        class="ml-2 text-[12px] text-lane-link hover:underline"
        onClick={event => {
          event.stopPropagation()
          props.onToggle()
        }}
      >
        {props.expanded ? t('ledger.closeLane') : t('ledger.openLane')}
      </button>
    </RowFrame>
  )
}
