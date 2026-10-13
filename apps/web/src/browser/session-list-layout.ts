/**
 * Column widths in px from the design (60 / 70 / 76 / 70 / 70). They hold the longer of the
 * two languages: the widest values are English headers and Chinese durations (`12小时48分`).
 */
export const COLUMNS = {
  flags: 'w-16',
  turns: 'w-[60px]',
  requests: 'w-[70px]',
  tokens: 'w-[76px]',
  duration: 'w-[70px]',
  active: 'w-[70px]',
} as const

/** DOM id of a row, for `aria-activedescendant`. */
export function optionId(traceId: string): string {
  return `session-${traceId}`
}
