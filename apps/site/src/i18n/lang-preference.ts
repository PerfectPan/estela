import type { Locale } from './locale.ts'

/** Same key the header switch writes. The `<head>` script and React both read it. */
export const LANG_STORAGE_KEY = 'estela-lang'

/** Set on `<html>` before paint when the visitor prefers Chinese, so docs stay hidden until the zh-CN body loads. */
export const DOCS_PENDING_CLASS = 'estela-docs-pending'

/** Safety net timeout so docs still reveal the English prerender if loading the zh-CN body fails. */
export const DOCS_PENDING_TIMEOUT_MS = 800

export function languageFrom(stored: string | null, navigatorLanguage: string): Locale {
  if (stored === 'en' || stored === 'zh-CN') {
    return stored
  }
  if (navigatorLanguage.toLowerCase().startsWith('zh')) {
    return 'zh-CN'
  }
  return 'en'
}
