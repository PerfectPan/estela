import type { ReactPromise } from 'react'
import { docs } from './source.ts'

type LoadedDoc = Awaited<ReturnType<NonNullable<ReturnType<typeof docs.getPage>>['load']>>

/** Promise carrying React 19's settled thenable fields (`status`, `value`, `reason`) for synchronous `use()`. */
type TrackedDocPromise = Promise<LoadedDoc> & ReactPromise<LoadedDoc>

const defaultIsSsr = () => import.meta.env.SSR

/**
 * Builds a tracked-promise doc loader so client swaps stay cached while SSR skips caching to keep Suspense intact.
 * @internal
 */
export function createDocLoader(isSsr: () => boolean = defaultIsSsr) {
  const docPromises = new Map<string, TrackedDocPromise>()

  function isDocLoaded(path: string): boolean {
    if (isSsr()) {
      return false
    }
    return docPromises.get(path)?.status === 'fulfilled'
  }

  function loadDoc(path: string): TrackedDocPromise {
    const page = docs.getPage(path)
    if (!page) {
      throw new Error(`unknown page: ${path}`)
    }
    if (isSsr()) {
      return page.load()
    }
    const existing = docPromises.get(path)
    if (existing) {
      return existing
    }
    const tracked: TrackedDocPromise = Object.assign(
      page.load().then(
        value => {
          void Object.assign(tracked, { status: 'fulfilled', value })
          return value
        },
        (reason: unknown) => {
          void Object.assign(tracked, { status: 'rejected', reason })
          docPromises.delete(path)
          throw reason
        },
      ),
      { status: 'pending' as const },
    )
    docPromises.set(path, tracked)
    return tracked
  }

  return { isDocLoaded, loadDoc }
}

const clientLoader = createDocLoader()

/** Reports whether `path` has already resolved on the client so swaps stay on the settled locale until ready. */
export const isDocLoaded = clientLoader.isDocLoaded

/**
 * Returns one stable tracked promise per client path and records React's thenable fields (`status`, `value`, `reason`)
 * when it settles so unconditional `use(loadDoc(path))` reads preloaded docs synchronously; rejected promises are evicted.
 * On SSR, skips the cache so every prerendered route still renders inside its Suspense boundary cleanly.
 */
export const loadDoc = clientLoader.loadDoc
