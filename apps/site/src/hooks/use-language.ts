import { createContext, use, useCallback, useLayoutEffect, useState } from 'react'
import type { Locale } from '@/i18n/locale.ts'

interface LanguageValue {
  readonly lang: Locale
  readonly setLang: (next: Locale) => void
}

const LanguageContext = createContext<LanguageValue | null>(null)
export const LanguageProvider = LanguageContext.Provider

export function useLanguage(): LanguageValue {
  const value = use(LanguageContext)
  if (value === null) {
    throw new Error('useLanguage requires RootShell')
  }
  return value
}

function readStored(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

export function useLanguageState({
  resolve,
  storageKey,
  pendingClass,
  pendingTimeout,
}: {
  readonly resolve: (stored: string | null, navigatorLanguage: string) => Locale
  readonly storageKey: string
  readonly pendingClass: string
  readonly pendingTimeout: number
}): LanguageValue {
  // Always start on the default server locale so hydration matches the prerendered HTML.
  const [lang, setLangState] = useState<Locale>('en')

  useLayoutEffect(() => {
    const resolved = resolve(readStored(storageKey), navigator.language || '')
    document.documentElement.lang = resolved
    if (resolved === 'en') {
      document.documentElement.classList.remove(pendingClass)
    }
    setLangState(resolved)
    const timeout = window.setTimeout(() => document.documentElement.classList.remove(pendingClass), pendingTimeout)
    return () => window.clearTimeout(timeout)
  }, [resolve, storageKey, pendingClass, pendingTimeout])

  const setLang = useCallback(
    (next: Locale) => {
      const x = window.scrollX
      const y = window.scrollY
      try {
        localStorage.setItem(storageKey, next)
      } catch {
        // Storage can be blocked; the choice then lasts for this page only.
      }
      document.documentElement.lang = next
      document.documentElement.classList.remove(pendingClass)
      setLangState(next)
      requestAnimationFrame(() => {
        window.scrollTo(x, y)
      })
    },
    [storageKey, pendingClass],
  )

  return { lang, setLang }
}
