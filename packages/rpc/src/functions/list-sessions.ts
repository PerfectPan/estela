import type { ListSessionsQuery, ListSessionsResult } from '../list-types.ts'
import { defineRpcFunction } from 'devframe'
import * as z from 'zod/mini'
import { parseInput } from './parse-input.ts'
import { requireSessionService } from './service.ts'

const QUERY = 'list-sessions: query must be a string of at most 1000 characters'
const SINCE = 'list-sessions: since must be a non-negative integer'
const FIRST = 'list-sessions: first must be an array of at most 500 trace ids'

/**
 * The browser is a client like any other: check the shape before the index sees it. `z.int` stops at the
 * safe-integer range; revisions count up from 0 and never get near it.
 */
const listSessionsQuery = z.nullish(
  z.object(
    {
      query: z.optional(z.string({ error: QUERY }).check(z.maxLength(1000, { error: QUERY }))),
      since: z.optional(z.int({ error: SINCE }).check(z.nonnegative({ error: SINCE }))),
      first: z.optional(
        z.array(z.string({ error: FIRST }), { error: FIRST }).check(z.maxLength(500, { error: FIRST })),
      ),
    },
    { error: 'list-sessions: expected an object' },
  ),
)

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
      return service.listSessions(parseInput(listSessionsQuery, input) ?? {})
    },
  }),
})
