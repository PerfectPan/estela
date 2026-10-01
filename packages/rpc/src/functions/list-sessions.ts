import type { ListSessionsQuery, ListSessionsResult } from '../list-types.ts'
import { defineRpcFunction } from 'devframe'
import { requireSessionService } from './service.ts'

export const listSessions = defineRpcFunction({
  name: 'list-sessions',
  type: 'query',
  jsonSerializable: true,
  setup: () => ({
    handler: async (input: ListSessionsQuery = {}): Promise<ListSessionsResult> => {
      const service = requireSessionService()
      if (!service.listSessions) {
        throw new Error('list-sessions is not available')
      }
      return service.listSessions(checkQuery(input))
    },
  }),
})

/** The browser is a client like any other: check the shape before the index sees it. */
export function checkQuery(input: unknown): ListSessionsQuery {
  if (input == null) {
    return {}
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('list-sessions: expected an object')
  }
  const { query, since, first } = input as Record<string, unknown>
  const out: ListSessionsQuery = {}
  if (query !== undefined) {
    if (typeof query !== 'string' || query.length > 1000) {
      throw new TypeError('list-sessions: query must be a string of at most 1000 characters')
    }
    out.query = query
  }
  if (since !== undefined) {
    if (typeof since !== 'number' || !Number.isInteger(since) || since < 0) {
      throw new TypeError('list-sessions: since must be a non-negative integer')
    }
    out.since = since
  }
  if (first !== undefined) {
    if (!Array.isArray(first) || first.length > 500 || !first.every(ref => typeof ref === 'string')) {
      throw new TypeError('list-sessions: first must be an array of at most 500 refs')
    }
    out.first = first
  }
  return out
}
