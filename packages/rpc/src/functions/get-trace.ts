import type { Trace } from '@rivus/agent-trace-schema'
import { fold } from '@rivus/agent-trace-kernel'
import { defineRpcFunction } from 'devframe'
import { requireSessionService } from './service.ts'

export interface TraceView {
  path: string
  trace: Trace
  fold: ReturnType<typeof fold>
}

export const getTrace = defineRpcFunction({
  name: 'get-trace',
  type: 'query',
  jsonSerializable: true,
  snapshot: true,
  agent: {
    description: 'Load the current agent-trace document (canonical events[] plus fold).',
  },
  // Legacy full-trace snapshot of the launch session, for the static build. The live workspace
  // reads `get-trace-view` + `get-event`; M5 replaces the build's use with `report-trace`.
  setup: () => ({
    handler: async (): Promise<TraceView> => {
      const view = await requireSessionService().view()
      return { path: view.path, trace: view.trace, fold: fold(view.trace) }
    },
  }),
})
