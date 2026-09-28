import type { TraceView } from './get-trace.ts'
import { defineRpcFunction } from 'devframe'
import { traceView } from './get-trace.ts'
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
    handler: async (input: { ref: string }): Promise<TraceView> => {
      const ref = (input as { ref?: unknown } | undefined)?.ref
      if (typeof ref !== 'string' || !/^[0-9a-f]{24}$/.test(ref))
        throw new TypeError('session-trace: ref must be a session ref')
      const service = requireSessionService()
      if (!service.sessionTrace)
        throw new Error('session-trace is not available')
      return traceView(await service.sessionTrace(ref))
    },
  }),
})
