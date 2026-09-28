import { trustedClient } from './client.ts'

/**
 * DevFrame's auth gate keeps its one-time code in the URL fragment, so the CLI opens a
 * session as `?s=<ref>`. After the client is trusted (DevFrame has read and removed the
 * code), the ref moves to the route `#/s/<ref>` and the query is removed.
 */
export async function bootLocation(): Promise<void> {
  const pending = new URLSearchParams(location.search).get('s')
  try {
    await trustedClient()
  }
  catch {
    // The screen renders and shows the connection error.
  }
  if (pending) {
    const url = new URL(location.href)
    url.searchParams.delete('s')
    url.hash = `#/s/${encodeURIComponent(pending)}`
    history.replaceState(null, '', url.href)
    return
  }
  if (!location.hash.startsWith('#/'))
    history.replaceState(null, '', `${location.pathname}${location.search}#/`)
}
