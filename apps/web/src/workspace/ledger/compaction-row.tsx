import type { Entry } from '@/lib/ledger-model.ts'
import { Show } from 'solid-js'
import { CompactIcon } from '@/components/icons.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { numberField } from '@/lib/event-text.ts'
import { formatNumber, formatTokens } from '@/lib/format.ts'
import type { RowContext } from './ledger-rows.tsx'
import { elapsed } from './ledger-rows.tsx'

export function CompactionRow(props: { entry: Extract<Entry, { type: 'compaction' }>; ctx: RowContext }) {
  const event = () => props.ctx.model.byId.get(props.entry.eventId)!
  const pre = () => numberField(event(), 'preTokens')
  const post = () => numberField(event(), 'postTokens')
  const stats = () => props.ctx.model.shadowed.get(props.entry.eventId)
  return (
    <div
      class="compaction-stripes flex h-full items-center gap-3 border-b border-border pr-4 pl-5"
      data-testid="compaction-row"
    >
      <span class="w-[30px] shrink-0" />
      <CompactIcon size={16} class="shrink-0 text-foreground" />
      <span class="shrink-0 text-[13px] font-medium text-foreground">
        {event().payload.trigger === 'auto' ? t('ledger.autoCompacted') : t('ledger.compacted')}
      </span>
      <Show when={pre() !== undefined && post() !== undefined}>
        <span class="shrink-0 font-mono text-[12px] text-muted-foreground">
          {t('ledger.compactionTokens', { pre: formatTokens(pre()!), post: formatTokens(post()!) })}
        </span>
      </Show>
      <span class="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
        <Show when={stats()?.from !== undefined && stats()}>
          {current => {
            const { count, from, to } = current()
            if (count === 1) {
              return t('ledger.leftViewOne', { from: from! })
            }
            const params = { count: formatNumber(count, locale()), from: from!, to: to! }
            return from === to ? t('ledger.leftViewSingle', params) : t('ledger.leftView', params)
          }}
        </Show>
      </span>
      <span class="w-[52px] shrink-0 text-right font-mono text-[11.5px] text-subtle">
        {elapsed(event().ts, props.ctx)}
      </span>
    </div>
  )
}
