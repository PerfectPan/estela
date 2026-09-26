import type { ReconstructResult, Trace } from '@rivus/agent-trace-schema'
import { fold, reconstruct } from '@rivus/agent-trace-kernel'
import { defineRpcFunction } from 'devframe'

export interface SessionView {
  path: string
  trace: Trace
}

export interface SessionService {
  view: () => Promise<SessionView>
}

let service: SessionService | undefined

export function bindSessionService(next: SessionService): void {
  service = next
}

function requireService(): SessionService {
  if (!service)
    throw new Error('session service is not bound')
  return service
}

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
  setup: () => ({
    handler: async (): Promise<TraceView> => {
      const view = await requireService().view()
      return { path: view.path, trace: view.trace, fold: fold(view.trace) }
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
      const view = await requireService().view()
      return reconstruct(view.trace, eventId)
    },
  }),
})
