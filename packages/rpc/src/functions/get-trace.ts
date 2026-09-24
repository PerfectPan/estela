import type { ReconstructResult, Trace } from '@rivus/agent-trace-schema'
import { fold, reconstruct } from '@rivus/agent-trace-kernel'
import { defineRpcFunction } from 'devframe'

export interface SessionService {
  path: string
  currentTrace: () => Promise<Trace>
}

const missing: SessionService = {
  path: '',
  currentTrace: () => Promise.reject(new Error('session service is not bound')),
}

let service: SessionService = missing

export function bindSessionService(next: SessionService): void {
  service = next
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
      const trace = await service.currentTrace()
      return { path: service.path, trace, fold: fold(trace) }
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
      const trace = await service.currentTrace()
      return reconstruct(trace, eventId)
    },
  }),
})
