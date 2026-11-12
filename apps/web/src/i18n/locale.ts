import { flatten, resolveTemplate, translator, type Flatten } from '@solid-primitives/i18n'
import { createSignal } from 'solid-js'
import { en, type Dictionary } from './dictionary.en.ts'
import { zhCN } from './dictionary.zh-CN.ts'

/** The UI languages; `shell/report.ts` checks a report's `locale` against this list. */
export const LOCALES = ['en', 'zh-CN'] as const
export type Locale = (typeof LOCALES)[number]
type FlatDictionary = Flatten<Dictionary>
export type MessageKey = {
  [K in keyof FlatDictionary]: FlatDictionary[K] extends string ? K : never
}[keyof FlatDictionary]

const STORAGE_KEY = 'estela-locale'

const dictionaries: Record<Locale, FlatDictionary> = {
  en: flatten(en),
  'zh-CN': flatten(zhCN),
}

const [locale, setLocale] = createSignal<Locale>('en')
export { locale }

const t = translator(() => dictionaries[locale()], resolveTemplate)

function stored(): Locale | undefined {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return LOCALES.find(known => known === value)
  } catch {
    return undefined
  }
}

/** `zh*` in `navigator.languages` selects `zh-CN`; anything else is `en`. A manual choice wins. */
export function preferredLocale(languages: readonly string[] = navigator.languages): Locale {
  const manual = stored()
  if (manual) {
    return manual
  }
  const first = languages.find(language => language.length > 0) ?? 'en'
  return first.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/** Sets the active locale and `<html lang>`. */
export function applyLocale(next: Locale = preferredLocale()): void {
  setLocale(next)
  document.documentElement.lang = next
}

/** A manual switch, kept in `localStorage`. */
export function chooseLocale(next: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  applyLocale(next)
}

export function translate(key: MessageKey, params?: Record<string, string | number>): string {
  const value = t(key, params)
  return typeof value === 'string' ? value : key
}

/** `one` for a count of exactly 1, else `many` with `{{ count }}` (English and Chinese need no other forms). */
export function plural(count: number, one: MessageKey, many: MessageKey, formatted: string = String(count)): string {
  return count === 1 ? translate(one) : translate(many, { count: formatted })
}
