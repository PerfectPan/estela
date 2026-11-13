import type { ContextDiffResult } from '@rivus/estela-kernel'
import type { WorkspaceState } from '../workspace-state.ts'
import { For, Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { formatNumber, formatTokens } from '@/lib/format.ts'
import { CompareEventList } from './compare-event-list.tsx'
import { CompareSlotRow } from './compare-slot-row.tsx'

/** One side of a compaction's pre → post: the recorded count, or the dash for a side the log left out. */
function tokensOrMissing(tokens: number | undefined): string {
  return tokens === undefined ? t('common.dash') : formatTokens(tokens)
}

function signedTokens(delta: number): string {
  return delta === 0 ? '±0' : `${delta > 0 ? '+' : '−'}${formatTokens(Math.abs(delta))}`
}

/**
 * The diff of two requests on one lane: the recorded input tokens and the compactions between
 * them, the change per slot, the events that entered the context, and the events a compaction hid.
 */
export function CompareBody(props: {
  result: ContextDiffResult
  selectedId: string
  label: (id: string) => string
  state: WorkspaceState
}) {
  const model = props.state.model
  const tokens = () => props.result.inputTokens
  const compactions = () =>
    props.result.compactionIds.flatMap(id => {
      const event = model.byId.get(id)
      return event?.kind === 'compaction' ? [event] : []
    })
  const side = (id: string) => (
    <span class={cx('font-medium', id === props.selectedId ? 'text-foreground' : 'text-muted-foreground')}>
      {props.label(id)}
      <Show when={id === props.selectedId}>
        <span class="ml-1.5 text-[12px] font-normal text-subtle">{t('compare.selected')}</span>
      </Show>
    </span>
  )
  return (
    <>
      <div class="flex flex-col gap-2" data-testid="compare-summary">
        <div class="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          {side(props.result.beforeId)}
          <span class="text-subtle">→</span>
          {side(props.result.afterId)}
        </div>
        <Show
          when={tokens().delta !== undefined}
          fallback={
            <p class="m-0 text-[12.5px] text-subtle" data-testid="compare-tokens-unavailable">
              {t('compare.tokensUnavailable')}
            </p>
          }
        >
          <div class="font-mono text-[22px] font-medium tracking-[-0.02em]" data-testid="compare-tokens">
            {formatTokens(tokens().before!)} → {formatTokens(tokens().after!)}{' '}
            <span class="text-[13px] font-normal tracking-normal text-muted-foreground">
              {signedTokens(tokens().delta!)} {t('compare.inputTokens')}
            </span>
          </div>
        </Show>
        <For each={compactions()}>
          {event => (
            <div
              class="flex items-center gap-2.5 border-t border-dashed border-hatch-edge pt-1.5 text-[12.5px] text-muted-foreground"
              data-testid="compare-compaction"
            >
              <span>{t('inspector.titles.compaction')}</span>
              <Show when={event.payload.trigger}>{trigger => <span class="text-subtle">{trigger()}</span>}</Show>
              <span class="font-mono text-[12px]">
                {event.payload.preTokens === undefined && event.payload.postTokens === undefined
                  ? t('compare.noCount')
                  : `${tokensOrMissing(event.payload.preTokens)} → ${tokensOrMissing(event.payload.postTokens)}`}
              </span>
            </div>
          )}
        </For>
      </div>
      <div class="flex flex-col gap-2">
        <h3 class="section-label m-0 text-muted-foreground">{t('compare.bySlot')}</h3>
        <ul class="m-0 flex list-none flex-col p-0" data-testid="compare-slots">
          <For each={props.result.slots}>
            {slot => <CompareSlotRow diff={slot} system={props.result.system} tools={props.result.tools} />}
          </For>
        </ul>
        <p class="m-0 text-[12px] leading-normal text-subtle">{t('compare.countsNote')}</p>
      </div>
      <CompareEventList
        title={t('compare.entered')}
        ids={props.result.entered}
        empty={t('compare.noneEntered')}
        testId="compare-entered"
        model={model}
        onSelectEvent={props.state.reveal}
      />
      <CompareEventList
        title={t('compare.compacted')}
        ids={props.result.compacted}
        empty={t('compare.noneCompacted')}
        struck
        testId="compare-compacted"
        model={model}
        onSelectEvent={props.state.reveal}
      />
      <Show when={props.result.left.length > 0}>
        <p class="m-0 text-[12px] text-subtle">
          {t('compare.leftNote', { count: formatNumber(props.result.left.length, locale()) })}
        </p>
      </Show>
    </>
  )
}
