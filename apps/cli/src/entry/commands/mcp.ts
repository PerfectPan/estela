import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { sessionTargetLabel } from '@rivus/estela-server'
import { createEstelaServer } from '../../server.ts'
import { CliError } from '../failure.ts'
import { sayMcpReady, sayStoreWarning } from '../ui/terminal.ts'

export interface McpInput {
  target: SessionTarget
}

/** MCP tools over one session on stdio. stdout carries the protocol only; everything else goes to stderr. Always redacted. */
export async function runMcp(input: McpInput): Promise<void> {
  const server = createEstelaServer({ catalog: undefined, launch: input.target, redacts: true, log: sayStoreWarning })
  try {
    await server.openLaunch()
  } catch (cause) {
    throw new CliError({ kind: 'session', action: 'load', label: sessionTargetLabel(input.target), cause })
  }
  const { createMcpServer } = await import('devframe/adapters/mcp')
  await createMcpServer(server.definition, {
    transport: 'stdio',
    onReady: ({ transport }) => sayMcpReady(server.definition.id, transport),
  })
}
