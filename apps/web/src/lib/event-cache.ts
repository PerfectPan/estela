/** Full events kept by the inspector: a full output can be megabytes. */
export const EVENT_CACHE_SIZE = 20

/**
 * `load` behind a small LRU of `size` promises. A hit moves the entry to the newest end; a
 * failed load is forgotten so the next call retries.
 */
export function createEventCache<T>(
  load: (id: string) => Promise<T>,
  size = EVENT_CACHE_SIZE,
): (id: string) => Promise<T> {
  const entries = new Map<string, Promise<T>>()
  return id => {
    const found = entries.get(id)
    if (found) {
      entries.delete(id)
      entries.set(id, found)
      return found
    }
    const next = load(id)
    entries.set(id, next)
    next.catch(() => {
      if (entries.get(id) === next) {
        entries.delete(id)
      }
    })
    while (entries.size > size) {
      entries.delete(entries.keys().next().value!)
    }
    return next
  }
}

/**
 * What the Raw tab asks `get-event` for: the selected ids, only while Raw is the open tab.
 * `undefined` makes the resource keep its last result without fetching.
 */
export function rawFetchKey(tab: string, ids: readonly string[]): string | undefined {
  return tab === 'raw' && ids.length > 0 ? ids.join('\0') : undefined
}
