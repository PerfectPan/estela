import type { Dictionary } from './dictionary.en.ts'
import { en } from './dictionary.en.ts'
import { zhCN } from './dictionary.zh-CN.ts'

export type Locale = 'en' | 'zh-CN'

export const LOCALES: { locale: Locale; label: string }[] = [
  { locale: 'en', label: 'EN' },
  { locale: 'zh-CN', label: '中文' },
]

const DICTIONARIES: Record<Locale, Dictionary> = { en, 'zh-CN': zhCN }

export function dictionaryOf(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}
