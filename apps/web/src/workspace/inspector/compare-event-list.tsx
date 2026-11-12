import type { LedgerModel } from '@/lib/ledger-model.ts'
import { For, Show, createSignal } from 'solid-js'
import { ArrowRightIcon } from '@/components/icons.tsx'
import { locale, plural, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { rowLine } from '@/lib/event-text.ts'
import { formatNumber, formatTokens } from '@/lib/format.ts'

/** Rows listed before "Show all". */
const PREVIEW = 4
/** Rows drawn after "Show all"; the rest is a count. */
const MAX = 300

/**
 * One list of a context diff: the events that entered the context, or the events a compaction
 * hid (struck through, as in Model saw's dropped list). A row selects its event.
 */
export function CompareEventList(props: {
  title: string
  ids: string[]
  empty: string
  struck?: boolean
  testId: string
  model: LedgerModel
  onSelectEvent: (id: string) => void
}) {
  const [showAll, setShowAll] = createSignal(false)
  const shown = () => props.ids.slice(0, showAll() ? MAX : PREVIEW)
  return (
    <div class="flex flex-col gap-2" data-testid={props.testId} data-count={props.ids.length}>
      <div class="flex items-baseline justify-between">
        <h3 class="section-label m-0 text-muted-foreground">{props.title}</h3>
        <span class="font-mono text-[12px] text-muted-foreground">
          {plural(
            props.ids.length,
            'inspector.droppedCountOne',
            'inspector.droppedCount',
            formatNumber(props.ids.length, locale()),
          )}
        </span>
      </div>
      <Show when={props.ids.length > 0} fallback={<p class="m-0 text-[12.5px] text-subtle">{props.empty}</p>}>
        <ul class="m-0 flex list-none flex-col p-0">
          <For each={shown()}>
            {id => {
              const found = () => props.model.byId.get(id)
              const ordinal = () => props.model.ordinals.get(id)
              /** A compaction row has no line of its own; it reads as the ledger's compaction row does. */
              const text = () => {
                const event = found()
                if (!event) {
                  return id
                }
                if (event.kind !== 'compaction') {
                  return rowLine(event)
                }
                const { preTokens, postTokens } = event.payload
                return preTokens !== undefined && postTokens !== undefined
                  ? `${t('inspector.titles.compaction')} · ${formatTokens(preTokens)} → ${formatTokens(postTokens)}`
                  : t('inspector.titles.compaction')
              }
              return (
                <li>
                  <button
                    type="button"
                    class="flex h-[26px] w-full min-w-0 items-center gap-2.5 text-left"
                    onClick={() => props.onSelectEvent(id)}
                  >
                    <span class="w-[34px] shrink-0 font-mono text-[11px] text-subtle">
                      {ordinal() ? `#${ordinal()}` : ''}
                    </span>
                    <span
                      class={cx(
                        'min-w-0 truncate text-[12.5px] [unicode-bidi:isolate]',
                        props.struck ? 'text-subtle line-through decoration-hatch-edge' : 'text-foreground',
                      )}
                      dir="auto"
                    >
                      {text()}
                    </span>
                  </button>
                </li>
              )
            }}
          </For>
        </ul>
        <Show when={showAll() && props.ids.length > MAX}>
          <span class="text-[12px] text-subtle">
            {t('inspector.andMore', { count: formatNumber(props.ids.length - MAX, locale()) })}
          </span>
        </Show>
        <Show when={props.ids.length > PREVIEW}>
          <button
            type="button"
            class="flex items-center gap-1.5 self-start text-[12.5px] text-link hover:underline"
            onClick={() => setShowAll(!showAll())}
          >
            {showAll()
              ? t('inspector.showFewer')
              : t('compare.showAll', { count: formatNumber(props.ids.length, locale()) })}
            <Show when={!showAll()}>
              <ArrowRightIcon size={13} />
            </Show>
          </button>
        </Show>
      </Show>
    </div>
  )
}
