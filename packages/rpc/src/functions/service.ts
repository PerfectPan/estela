import type { Trace } from '@rivus/agent-trace-schema'
import type { ListSessionsQuery, ListSessionsResult } from '../list-types.ts'

export interface SessionView {
  path: string
  trace: Trace
}

/**
 * `get-trace` (the launch session, full; bound by `build` and `mcp` only) and `list-sessions`
 * (the dev server). Traces by ref come from the TraceStore.
 */
export interface SessionService {
  view?: () => Promise<SessionView>
  listSessions?: (input: ListSessionsQuery) => Promise<ListSessionsResult>
}

let service: SessionService | undefined

export function bindSessionService(next: SessionService): void {
  service = next
}

export function requireSessionService(): SessionService {
  if (!service)
    throw new Error('session service is not bound')
  return service
}
