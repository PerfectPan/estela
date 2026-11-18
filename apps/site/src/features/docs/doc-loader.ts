import { docs } from './source.ts'

export type LoadedDoc = Awaited<ReturnType<NonNullable<ReturnType<typeof docs.getPage>>['load']>>

const pendingLoads = new Map<string, Promise<LoadedDoc>>()
const loadedDocs = new Map<string, LoadedDoc>()

/** Returns an already-resolved client MDX module for `path` so a swap commits synchronously without Suspense blanking. */
export function getLoadedDoc(path: string): LoadedDoc | undefined {
  if (import.meta.env.SSR) {
    return undefined
  }
  return loadedDocs.get(path)
}

/** Loads and caches the compiled MDX module for `path` (deduplicates concurrent calls for `use()`). */
export function loadDoc(path: string): Promise<LoadedDoc> {
  const existing = pendingLoads.get(path)
  if (existing) {
    return existing
  }
  const page = docs.getPage(path)
  if (!page) {
    throw new Error(`unknown page: ${path}`)
  }
  const promise = page.load().then(data => {
    if (!import.meta.env.SSR) {
      loadedDocs.set(path, data)
    }
    return data
  })
  pendingLoads.set(path, promise)
  return promise
}
