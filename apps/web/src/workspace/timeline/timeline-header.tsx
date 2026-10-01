import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatDuration, formatNumber } from '@/lib/format.ts'
import { TimelineLegend } from './timeline-legend.tsx'

/**
 * "TIMELINE", the selected range and its event count (S6), and the legend. The range text
 * is a live region, so a keyboard user hears the new range after each handle step.
 */
export function TimelineHeader(props: {
  /** Elapsed ms from the session start; `undefined` when the whole session is shown. */
  range?: { from: number; to: number }
  duration: number
  count: number
  onClear: () => void
}) {
  const count = () => formatNumber(props.count, locale())
  const text = () => {
    const range = props.range
    if (!range) {
      return t('timeline.rangeAll', { duration: formatDuration(props.duration, locale()), count: count() })
    }
    return t('timeline.rangeSelected', {
      from: formatDuration(range.from, locale()),
      to: formatDuration(range.to, locale()),
      count: count(),
    })
  }
  return (
    <div class="flex items-center justify-between gap-4 px-5 pt-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <h2 class="section-label m-0 text-muted-foreground">{t('timeline.title')}</h2>
        <span
          class="truncate font-mono text-[12px] text-muted-foreground"
          aria-live="polite"
          data-testid="timeline-range"
        >
          {text()}
        </span>
        <Show when={props.range}>
          <button
            type="button"
            class="rounded px-1 text-[12px] text-link hover:underline"
            onClick={() => props.onClear()}
          >
            {t('timeline.clear')}
          </button>
        </Show>
      </div>
      <ul class="m-0 flex shrink-0 list-none items-center gap-4 p-0 text-[12px] text-muted-foreground">
        <TimelineLegend mark={<span class="size-2.5 rounded-[2px] bg-kind-request" />}>
          {t('timeline.legendRequest')}
        </TimelineLegend>
        <TimelineLegend mark={<span class="size-2.5 rounded-full bg-kind-user" />}>
          {t('timeline.legendPrompt')}
        </TimelineLegend>
        <TimelineLegend mark={<span class="size-2.5 rounded-[2px] bg-kind-tool" />}>
          {t('timeline.legendTool')}
        </TimelineLegend>
        <TimelineLegend mark={<span class="size-2.5 rounded-[2px] bg-kind-subagent" />}>
          {t('timeline.legendSubagent')}
        </TimelineLegend>
        <TimelineLegend
          mark={
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M5 1 L9.5 9 H0.5 Z" fill="var(--destructive)" />
            </svg>
          }
        >
          {t('timeline.legendFailed')}
        </TimelineLegend>
        <TimelineLegend mark={<span class="h-3 w-0 border-l-[1.5px] border-dashed border-foreground" />}>
          {t('timeline.legendCompaction')}
        </TimelineLegend>
      </ul>
    </div>
  )
}
