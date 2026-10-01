import { translate as t } from '@/i18n/locale.ts'

/** Text inset inside the box, left and right. */
export const PAD = 8

export function moreText(more: number): string {
  return more > 0 ? `  ${t('timeline.moreCompactions', { count: more })}` : ''
}
