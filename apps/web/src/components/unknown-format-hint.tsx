import { Show } from 'solid-js'
import { translate as t } from '@/i18n/locale.ts'
import { isUnknownFormatGeneration, REPORT_ISSUE_URL } from '@/lib/read-error.ts'

export function UnknownFormatHint(props: { reason: string }) {
  return (
    <Show when={isUnknownFormatGeneration(props.reason)}>
      <p class="m-0 text-[12px] leading-[1.5] text-muted-foreground" data-testid="unknown-format-hint">
        {t('common.unknownFormatHint')}{' '}
        <a href={REPORT_ISSUE_URL} target="_blank" rel="noopener noreferrer" class="text-link hover:underline">
          {t('common.reportIssue')}
        </a>
      </p>
    </Show>
  )
}
