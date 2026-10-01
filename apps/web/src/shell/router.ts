import { createSignal, onCleanup } from 'solid-js'

export type Route = { name: 'browser' } | { name: 'workspace'; ref: string }

export function parseRoute(hash: string): Route {
  const match = /^#\/s\/([^/?#]+)$/.exec(hash)
  if (!match?.[1]) {
    return { name: 'browser' }
  }
  try {
    return { name: 'workspace', ref: decodeURIComponent(match[1]) }
  } catch {
    // A malformed escape (`#/s/%E0`) is not a session.
    return { name: 'browser' }
  }
}

export function useRoute(): () => Route {
  const [route, setRoute] = createSignal<Route>(parseRoute(location.hash))
  const onHash = () => setRoute(parseRoute(location.hash))
  window.addEventListener('hashchange', onHash)
  onCleanup(() => window.removeEventListener('hashchange', onHash))
  return route
}

export function openSession(ref: string): void {
  location.hash = `#/s/${encodeURIComponent(ref)}`
}
