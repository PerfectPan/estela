import type { ReconstructResult, Trace } from '@rivus/agent-trace-schema'
import { fold, reconstruct } from '@rivus/agent-trace-kernel'
import { defineRpcFunction } from 'devframe'
import type { SessionView } from './service.ts'
import { requireSessionService } from './service.ts'

export interface TraceView {
  path: string
  trace: Trace
  fold: ReturnType<typeof fold>
}

export function traceView(view: SessionView): TraceView {
  return { path: view.path, trace: view.trace, fold: fold(view.trace) }
}

export const getTrace = defineRpcFunction({
  name: 'get-trace',
  type: 'query',
  jsonSerializable: true,
  snapshot: true,
  agent: {
    description: 'Load the current agent-trace document (canonical events[] plus fold).',
  },
  setup: () => ({
    handler: async (): Promise<TraceView> => {
      return traceView(await requireSessionService().view())
    },
  }),
})

export const reconstructAt = defineRpcFunction({
  name: 'reconstruct',
  type: 'query',
  jsonSerializable: true,
  agent: {
    description: 'Reconstruct the model-visible surface at one event id. Missing slots are unavailable, never invented.',
  },
  setup: () => ({
    handler: async ({ eventId }: { eventId: string }): Promise<ReconstructResult> => {
      const view = await requireSessionService().view()
      return reconstruct(view.trace, eventId)
    },
  }),
})
