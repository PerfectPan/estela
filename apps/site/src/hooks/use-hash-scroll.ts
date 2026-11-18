import { useEffect } from 'react'

/** Scrolls the target heading into view once lazy MDX content for `path` and `lang` has committed. */
export function useHashScroll(path: string, lang: string): void {
  useEffect(() => {
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
  }, [path, lang])
}
