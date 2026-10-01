import type { Entry } from '@/lib/ledger-model.ts'
import { HooksIcon } from '@/components/icons.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { formatNumber } from '@/lib/format.ts'

export function HooksRow(props: { entry: Extract<Entry, { type: 'hooks' }>; depth: 0 | 1 }) {
  return (
    <div
      class={cx(
        'flex h-full items-center gap-2.5 border-b border-border pr-4 text-subtle',
        props.depth === 1 ? 'pl-[88px]' : 'pl-16',
      )}
    >
      <HooksIcon size={13} />
      <span class="text-[12px]">{t('ledger.hooksFolded', { count: formatNumber(props.entry.count, locale()) })}</span>
    </div>
  )
}
