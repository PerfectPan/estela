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
      if (!service.listSessions)
        throw new Error('list-sessions is not available')
      return service.listSessions(input)
    },
  }),
})
