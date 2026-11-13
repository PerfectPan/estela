import type { ContextDiff, ContextDiffResult } from '@rivus/estela-kernel'
import type { WorkspaceState } from '../workspace-state.ts'
import { diffContext } from '@rivus/estela-kernel'
import { For, Match, Show, Switch, createMemo } from 'solid-js'
import { translate as t } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva'
import { compareChoices, compareTarget } from '@/lib/context-compare.ts'
import { formatTokens } from '@/lib/format.ts'
import { CompareBody } from './compare-body.tsx'

const chip = (active: boolean) =>
  cx(
    'rounded-[7px] border px-2.5 py-1 text-[12.5px] whitespace-nowrap',
    active ? 'border-input bg-muted text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
  )

/**
 * Compare (S1–S8 of spec 0007): the selected request's context against another request of its lane,
 * from kernel `diffContext` on the view trace. Counts per slot are events, never tokens; the only
 * token numbers are the recorded input tokens of the two requests and each compaction's pre → post.
 */
export function ContextCompare(props: { state: WorkspaceState; eventId: string }) {
  const model = props.state.model
  const choices = createMemo(() => compareChoices(model, props.eventId))
  const target = () => compareTarget(choices(), props.state.comparePick())
  const diff = createMemo((): ContextDiff | undefined => {
    const other = target()
    return other ? diffContext(model.trace, other, props.eventId) : undefined
  })
  const compared = (): ContextDiffResult | undefined => {
    const current = diff()
    return current?.status === 'compared' ? current : undefined
  }
  const label = (id: string) => `${t('inspector.titles.request')} #${model.ordinals.get(id) ?? '?'}`
  const optionLabel = (id: string, tokens: number | undefined) =>
    `${label(id)} · ${tokens !== undefined ? formatTokens(tokens) : t('compare.noCount')}`

  return (
    <Switch>
      <Match when={!model.requests.has(props.eventId)}>
        <p class="m-0 text-[13px] text-subtle" data-testid="compare-empty">
          {t('compare.selectRequest')}
        </p>
      </Match>
      <Match when={choices().options.length === 0}>
        <p class="m-0 text-[13px] text-subtle" data-testid="compare-empty">
          {t('compare.noOther')}
        </p>
      </Match>
      <Match when={true}>
        <div class="flex flex-col gap-[18px]" data-testid="context-compare">
          <div class="flex flex-col gap-2.5">
            <div class="flex items-center justify-between gap-3">
              <label class="section-label m-0 text-muted-foreground" for="compare-pick">
                {t('compare.with')}
              </label>
              <select
                id="compare-pick"
                class="h-7 max-w-[260px] min-w-0 rounded-[7px] border border-input bg-muted px-2 font-mono text-[12px] text-foreground"
                data-testid="compare-pick"
                value={target() ?? ''}
                onChange={event => props.state.compareWith(event.currentTarget.value)}
              >
                <For each={choices().options}>
                  {option => <option value={option.id}>{optionLabel(option.id, option.inputTokens)}</option>}
                </For>
              </select>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <Show when={choices().previous}>
                {id => (
                  <button
                    type="button"
                    class={chip(target() === id())}
                    data-testid="compare-previous"
                    onClick={() => props.state.compareWith(id())}
                  >
                    {t('compare.previous')}
                  </button>
                )}
              </Show>
              <Show when={choices().beforeCompaction}>
                {id => (
                  <button
                    type="button"
                    class={chip(target() === id())}
                    data-testid="compare-before-compaction"
                    onClick={() => props.state.compareWith(id())}
                  >
                    {t('compare.beforeCompaction')}
                  </button>
                )}
              </Show>
              <span class="text-[12px] text-subtle">{t('compare.timelineHint')}</span>
            </div>
          </div>
          <Show when={diff()?.status === 'rejected'}>
            <p class="m-0 text-[13px] text-subtle" data-testid="compare-rejected">
              {t('compare.rejected')}
            </p>
          </Show>
          <Show when={compared()} keyed>
            {result => <CompareBody result={result} selectedId={props.eventId} label={label} state={props.state} />}
          </Show>
        </div>
      </Match>
    </Switch>
  )
}
