import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-start/client'
import { isDocsPath, stripIndexHtmlSuffix } from '@/features/docs/docs-path.ts'

function normalizeDirectoryUrl(): void {
  const normalized = stripIndexHtmlSuffix(window.location.pathname)
  if (normalized) {
    window.history.replaceState(null, '', `${normalized}${window.location.search}${window.location.hash}`)
  }
}

async function start(): Promise<void> {
  normalizeDirectoryUrl()
  if (isDocsPath(window.location.pathname)) {
    const lang = document.documentElement.lang
    const preload = import('@/features/docs/preload-docs.ts')
      .then(({ preloadDocsForLocation }) => preloadDocsForLocation(window.location.pathname, lang))
      .catch(error => {
        console.error('Failed to preload docs page:', error)
      })
    // Only Chinese readers await the preload before hydration, because switching away from the English
    // prerender while the body boundary is still dehydrated discards `#nd-page` and loses scroll.
    if (lang === 'zh-CN') {
      await preload
    }
  }
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    )
  })
}

void start()
