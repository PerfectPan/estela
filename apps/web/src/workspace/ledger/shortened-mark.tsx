import { translate as t } from '@/i18n/locale.ts'

export function ShortenedMark() {
  return (
    <span
      class="inline-flex shrink-0 rounded border border-input px-1.5 align-[1px] text-[10.5px] leading-[15px] text-muted-foreground"
      data-testid="shortened"
    >
      {t('ledger.shortened')}
    </span>
  )
}
