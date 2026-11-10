import type { Trace } from '@rivus/agent-trace-schema'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { bindTraceStore } from '@rivus/agent-trace-rpc'
import devframe from '../../server/devframe.ts'
import { createTraceStore } from '../../server/trace-store.ts'
import { loadSession } from '../../sessions/load-session.ts'
import { sessionTargetLabel } from '../../sessions/session-target.ts'
import { CliError } from '../failure.ts'
import { sayMcpReady, sayStoreWarning } from '../ui/terminal.ts'

export interface McpInput {
  target: SessionTarget
}

/** MCP tools over one session on stdio. stdout carries the protocol only; everything else goes to stderr. Always redacted. */
export async function runMcp(input: McpInput): Promise<void> {
  const label = sessionTargetLabel(input.target)
  let trace: Trace
  try {
    trace = await loadSession(input.target, { platform: createNodePlatform() })
  } catch (cause) {
    throw new CliError({ kind: 'session', action: 'load', label, cause })
  }
  const traces = createTraceStore({ redacts: true, log: sayStoreWarning })
  bindTraceStore(traces.store)
  await traces.seed({ key: label, target: input.target }, trace)
  const { createMcpServer } = await import('devframe/adapters/mcp')
  await createMcpServer(devframe, {
    transport: 'stdio',
    onReady: ({ transport }) => sayMcpReady(devframe.id, transport),
  })
}
