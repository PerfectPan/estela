import type { ReconstructResult, Trace } from '@agent-trace/schema'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { claudeCodeAdapter } from '@agent-trace/adapter-claude-code'
import { codexAdapter } from '@agent-trace/adapter-codex'
import { dshAdapter } from '@agent-trace/adapter-dsh'
import { grokAdapter } from '@agent-trace/adapter-grok'
import { opencodeAdapter } from '@agent-trace/adapter-opencode'
import { fold, loadTrace, reconstruct, redact } from '@agent-trace/kernel'
import { defineRpcFunction } from 'devframe'

const defaultFixture = fileURLToPath(new URL('../../../../../fixtures/demo.trace.json', import.meta.url))

const adapters = [
  grokAdapter,
  opencodeAdapter,
  codexAdapter,
  claudeCodeAdapter,
  dshAdapter,
]

async function currentTrace(): Promise<Trace> {
  const path = process.env.AGENT_TRACE_PATH || defaultFixture
  const trace = await loadTrace(path, adapters)
  return process.env.AGENT_TRACE_REDACT === '0' ? trace : redact(trace)
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
      const path = process.env.AGENT_TRACE_PATH || defaultFixture
      const trace = await currentTrace()
      return { path, trace, fold: fold(trace) }
    },
  }),
})

export const reconstructAt = defineRpcFunction({
  name: 'reconstruct',
  type: 'query',
  jsonSerializable: true,
  snapshot: true,
  agent: {
    description: 'Reconstruct the model-visible surface at one event id. Missing slots are unavailable, never invented.',
  },
  setup: () => ({
    handler: async ({ eventId }: { eventId: string }): Promise<ReconstructResult> => {
      const trace = await currentTrace()
      return reconstruct(trace, eventId)
    },
  }),
})
