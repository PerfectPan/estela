import type { ReportTrace } from '@rivus/estela-rpc'
import { Show } from 'solid-js'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatNumber } from '@/lib/format.ts'

/** Report mode: what the redaction did and did not remove, and how many originals are included. */
export function ReportBanner(props: { report: ReportTrace }) {
  return (
    <div
      class="flex shrink-0 flex-col gap-0.5 border-b border-border bg-secondary px-5 py-1.5 text-[12px] text-muted-foreground"
      role="note"
      data-testid="report-banner"
    >
      <span>{t('report.banner')}</span>
      <Show when={props.report.truncated}>
        <span data-testid="report-truncated">
          {t('report.truncated', {
            included: formatNumber(props.report.events.length, locale()),
            total: formatNumber(props.report.total, locale()),
          })}
        </span>
      </Show>
    </div>
  )
}
