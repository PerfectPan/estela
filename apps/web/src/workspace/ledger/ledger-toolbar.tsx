import type { LedgerFilter, LedgerLayout } from '@/lib/ledger-model.ts'
import type { MessageKey } from '@/i18n/locale.ts'
import { For, Show } from 'solid-js'
import { EyeIcon } from '@/components/icons.tsx'
import { locale, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { formatNumber } from '@/lib/format.ts'

const CHIPS: { id: LedgerFilter; label: MessageKey }[] = [
  { id: 'all', label: 'ledger.all' },
  { id: 'requests', label: 'ledger.requests' },
  { id: 'tools', label: 'ledger.tools' },
  { id: 'failures', label: 'ledger.failures' },
]

const LAYOUTS: { id: LedgerLayout; label: MessageKey; testId: string }[] = [
  { id: 'turns', label: 'ledger.layoutTurns', testId: 'layout-turns' },
  { id: 'lanes', label: 'ledger.layoutLanes', testId: 'layout-lanes' },
]

/** 42 px bar over the ledger: kind chips, the layout toggle, and the "dim hidden events" switch. */
export function LedgerToolbar(props: {
  filter: LedgerFilter
  onFilter: (filter: LedgerFilter) => void
  failures: number
  layout: LedgerLayout
  onLayout: (layout: LedgerLayout) => void
  dim: boolean
  onDim: (dim: boolean) => void
}) {
  return (
    <div class="flex h-[42px] shrink-0 items-center justify-between gap-3 border-b border-border pr-4 pl-5">
      <div class="flex items-center gap-2" role="radiogroup" aria-label={t('ledger.filterLabel')}>
        <For each={CHIPS}>
          {chip => (
            <button
              type="button"
              role="radio"
              aria-checked={props.filter === chip.id}
              class={cx(
                'flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[13px] whitespace-nowrap',
                props.filter === chip.id
                  ? 'border-input bg-muted text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              onClick={() => props.onFilter(chip.id)}
            >
              {t(chip.label)}
              <Show when={chip.id === 'failures' && props.failures > 0}>
                <span class="font-mono text-[11px] text-destructive">{formatNumber(props.failures, locale())}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1" role="radiogroup" aria-label={t('ledger.layoutLabel')}>
          <For each={LAYOUTS}>
            {item => (
              <button
                type="button"
                role="radio"
                aria-checked={props.layout === item.id}
                class={cx(
                  'flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[12.5px] whitespace-nowrap',
                  props.layout === item.id
                    ? 'border-input bg-muted text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
                data-testid={item.testId}
                onClick={() => props.onLayout(item.id)}
              >
                {t(item.label)}
              </button>
            )}
          </For>
        </div>
        <button
          type="button"
          aria-pressed={props.dim}
          class={cx(
            'flex items-center gap-2 rounded-[7px] border px-2 py-1 text-[12.5px] whitespace-nowrap',
            props.dim
              ? 'border-input bg-muted text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
          data-testid="dim-hidden"
          onClick={() => props.onDim(!props.dim)}
        >
          <EyeIcon />
          {t('ledger.dimHidden')}
        </button>
      </div>
    </div>
  )
}
