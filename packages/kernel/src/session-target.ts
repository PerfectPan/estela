import type { SessionTarget } from '@rivus/agent-kit/transcript'

/**
 * The kit's `SessionTarget` of a `path` or `path#sessionId` string, the form a session takes on the command line. It
 * names no agent, so the kit's `detect` picks the adapter. A `#` at the start is part of the path, and a trailing `#`
 * names no session.
 */
export function parseSessionTarget(input: string): SessionTarget {
  const hash = input.lastIndexOf('#')
  if (hash <= 0) {
    return { path: input }
  }
  const sessionId = input.slice(hash + 1)
  return sessionId ? { path: input.slice(0, hash), sessionId } : { path: input.slice(0, hash) }
}
