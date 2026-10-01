import type { TurnGroup } from '@/lib/ledger-model.ts'
import { Show } from 'solid-js'
import { ChevronDownIcon, ChevronRightIcon, EyeIcon } from '@/components/icons.tsx'
import { locale, plural, translate as t } from '@/i18n/locale.ts'
import { formatDuration, formatNumber } from '@/lib/format.ts'
import { previewText } from '@/lib/preview.ts'
import type { RowContext } from './ledger-rows.tsx'

/** 40 px turn header: chevron, "Turn N", the prompt, the hidden badge, requests and duration. */
export function TurnHeader(props: {
  group: TurnGroup
  number?: number
  collapsed: boolean
  ctx: RowContext
  onToggle: () => void
}) {
  const prompt = () => {
    const id = props.group.turn.promptEventId
    const text = id ? props.ctx.model.byId.get(id)?.payload.text : undefined
    return typeof text === 'string' && text.trim() ? `“${previewText(text)}”` : ''
  }
  const totals = () => {
    const turn = props.group.turn.totals
    return [
      plural(turn.requests, 'ledger.requestCountOne', 'ledger.requestCount', formatNumber(turn.requests, locale())),
      turn.durationMs !== undefined ? formatDuration(turn.durationMs, locale()) : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }
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
      <span class="min-w-[52px] shrink-0 text-[12.5px] font-semibold whitespace-nowrap text-foreground">
        {props.number === undefined ? t('ledger.beforePrompt') : t('ledger.turn', { index: props.number })}
      </span>
      <span class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground [unicode-bidi:isolate]" dir="auto">
        {prompt()}
      </span>
      <Show when={props.group.hidden > 0}>
        <span class="flex shrink-0 items-center gap-1.5 rounded-full border border-input px-[9px] py-0.5 text-[11.5px] text-muted-foreground">
          <EyeIcon size={12} class="text-subtle" />
          {t('ledger.hiddenBadge')}
        </span>
      </Show>
      <span class="shrink-0 font-mono text-[11.5px] text-subtle">{totals()}</span>
    </div>
  )
}
