import { useCallback, useEffect, useRef, useState } from 'react'
import type { Locale } from '@/i18n/locale.ts'
import { isDocLoaded, loadDoc } from './doc-loader.ts'

interface SettledDocsState {
  readonly splatKey: string
  readonly lang: Locale
}

/**
 * Decides which locale `DocsScreen` should render:
 * switches to `lang` on cross-page navigation, when `lang` matches the settled locale, or when
 * the target MDX chunk is already loaded; otherwise keeps `settled.lang` mounted so slow or
 * failed chunks never blank the article.
 * @internal
 */
export function resolveActiveLocale({
  settled,
  splatKey,
  lang,
  targetLoaded,
}: {
  settled: SettledDocsState
  splatKey: string
  lang: Locale
  targetLoaded: boolean
}): Locale {
  if (settled.splatKey !== splatKey) {
    return lang
  }
  if (settled.lang === lang || targetLoaded) {
    return lang
  }
  return settled.lang
}

/**
 * Returns a new settled record only when route or locale changed, preserving reference stability.
 * @internal
 */
export function reconcileSettledState(current: SettledDocsState, next: SettledDocsState): SettledDocsState {
  if (current.splatKey === next.splatKey && current.lang === next.lang) {
    return current
  }
  return next
}

/**
 * Decides how to handle a rejected MDX load: first failure surfaces the inline error notice for
 * `targetPath`; a failure on an explicit retry reloads the page so Chromium clears any cached
 * failed dynamic `import()` entry in the document's module map.
 * @internal
 */
export function resolveLoadFailureAction(
  retrying: boolean,
  targetPath: string,
): { action: 'reload'; failedPath: null } | { action: 'show-error'; failedPath: string } {
  if (retrying) {
    return { action: 'reload', failedPath: null }
  }
  return { action: 'show-error', failedPath: targetPath }
}

/**
 * Keeps the visible locale (both sidebar and article) mounted while a target locale chunk loads or fails,
 * surfacing `loadError` and a `retry` trigger instead of swallowing rejections.
 */
export function useSettledDocsLocale({
  splatKey,
  lang,
  targetPath,
}: {
  splatKey: string
  lang: Locale
  targetPath: string
}): { activeLang: Locale; loadError: boolean; retry: () => void } {
  const [settled, setSettled] = useState<SettledDocsState>({ splatKey, lang })
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const retryingRef = useRef(false)

  const activeLang = resolveActiveLocale({
    settled,
    splatKey,
    lang,
    targetLoaded: isDocLoaded(targetPath),
  })

  useEffect(() => {
    let cancelled = false
    void loadDoc(targetPath).then(
      () => {
        if (cancelled) {
          return
        }
        retryingRef.current = false
        setFailedPath(null)
        setSettled(current => reconcileSettledState(current, { splatKey, lang }))
      },
      (error: unknown) => {
        if (cancelled) {
          return
        }
        console.error(`Failed to load doc module ${targetPath}:`, error)
        const outcome = resolveLoadFailureAction(retryingRef.current, targetPath)
        retryingRef.current = false
        if (outcome.action === 'reload') {
          window.location.reload()
          return
        }
        setFailedPath(outcome.failedPath)
      },
    )
    return () => {
      cancelled = true
    }
  }, [targetPath, splatKey, lang, retryCount])

  const retry = useCallback(() => {
    retryingRef.current = true
    setFailedPath(null)
    setRetryCount(count => count + 1)
  }, [])

  return {
    activeLang,
    loadError: failedPath === targetPath,
    retry,
  }
}
