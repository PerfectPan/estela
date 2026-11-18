import { StrictMode, startTransition } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { StartClient } from '@tanstack/react-start/client'
import { normalizeBasePath } from '@/lib/site.ts'

const docsPrefix = `${normalizeBasePath(import.meta.env.BASE_URL)}/docs`

function isDocsPath(pathname: string): boolean {
  return pathname === docsPrefix || pathname.startsWith(`${docsPrefix}/`)
}

async function start(): Promise<void> {
  if (isDocsPath(window.location.pathname)) {
    try {
      const { preloadDocsForLocation } = await import('@/features/docs/preload-docs.ts')
      await preloadDocsForLocation(window.location.pathname, document.documentElement.lang)
    } catch (error) {
      console.error('Failed to preload docs page:', error)
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
