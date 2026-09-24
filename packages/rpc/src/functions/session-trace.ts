import type { TraceView } from './get-trace.ts'
import { fold } from '@rivus/agent-trace-kernel'
import { defineRpcFunction } from 'devframe'
import { requireSessionService } from './service.ts'

/**
 * The full trace of one session by its opaque ref, for the workspace route.
 * A stopgap until M4 replaces it with `get-trace-view(ref)` and `get-event(ref, id)`.
 */
export const sessionTrace = defineRpcFunction({
  name: 'session-trace',
  type: 'query',
  jsonSerializable: true,
  setup: () => ({
    handler: async ({ ref }: { ref: string }): Promise<TraceView> => {
      const service = requireSessionService()
      if (!service.sessionTrace)
        throw new Error('session-trace is not available')
      const view = await service.sessionTrace(ref)
      return { path: view.path, trace: view.trace, fold: fold(view.trace) }
    },
  }),
})
