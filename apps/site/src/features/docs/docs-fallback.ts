import type { Locale } from '@/i18n/locale.ts'

/** A Chinese request whose source file is still the English fallback (such as `design/README.md`). */
export function englishFallback(lang: Locale, pagePath: string): boolean {
  return lang === 'zh-CN' && !pagePath.endsWith('.zh-CN.md')
}
