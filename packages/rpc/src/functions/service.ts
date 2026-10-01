import type { ListSessionsQuery, ListSessionsResult } from '../list-types.ts'

/** `list-sessions` on the dev server. Traces by ref come from the TraceStore. */
export interface SessionService {
  listSessions?: (input: ListSessionsQuery) => Promise<ListSessionsResult>
}

let service: SessionService | undefined

export function bindSessionService(next: SessionService): void {
  service = next
}

export function requireSessionService(): SessionService {
  if (!service) {
    throw new Error('session service is not bound')
  }
  return service
}
