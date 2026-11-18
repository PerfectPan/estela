import { useEffect, useRef } from 'react'
import { useElementScrollRestoration, useRouterState } from '@tanstack/react-router'
import { DOCS_PENDING_CLASS } from '@/i18n/lang-preference.ts'

/**
 * Scrolls the target heading into view once per resolved history entry after the body commits in the reader's
 * locale, deferring while `estela-docs-pending` hides the English prerender and restoring any saved router position.
 */
export function useHashScroll(path: string, inTargetLang: boolean): void {
  // Read `resolvedLocation` (like router-core's scroll restoration) so an in-flight navigation never consumes the new entry key on the previous page's DOM.
  const entryKey = useRouterState({
    select: state => {
      const loc = state.resolvedLocation ?? state.location
      return loc.state.__TSR_key ?? loc.href
    },
  })
  const savedPosition = useElementScrollRestoration({
    getElement: () => (typeof window === 'undefined' ? null : window),
  })
  const scrolledKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (scrolledKeyRef.current === entryKey) {
      return
    }
    if (!inTargetLang) {
      return
    }
    if (document.documentElement.classList.contains(DOCS_PENDING_CLASS)) {
      return
    }
    scrolledKeyRef.current = entryKey
    if (savedPosition) {
      window.scrollTo({ left: savedPosition.scrollX, top: savedPosition.scrollY, behavior: 'instant' })
      return
    }
    if (window.location.hash.length <= 1) {
      return
    }
    let id: string
    try {
      id = decodeURIComponent(window.location.hash.slice(1))
    } catch {
      return
    }
    document.getElementById(id)?.scrollIntoView()
  }, [entryKey, path, inTargetLang, savedPosition])
}
