import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { sessionTargetLabel } from '@rivus/estela-server'
import { createEstelaServer } from '../../server.ts'
import { closeOnSignal } from '../close-on-signal.ts'
import { CliError } from '../failure.ts'
import { sayMcpReady, sayStoreWarning } from '../ui/terminal.ts'
import { sayUnreadableRoots, unreadableRootLine } from '../ui/unreadable-roots.ts'

export interface McpInput {
  /** The session given on the command line or in ESTELA_PATH; `undefined` serves every discovered session. */
  target: SessionTarget | undefined
}

/**
 * MCP tools on stdio: over the session catalog (every discovered session, through the session index), or over the
 * one session given, which is `current`. stdout carries the protocol only; everything else goes to stderr. Tool
 * results are always redacted.
 */
export async function runMcp(input: McpInput): Promise<void> {
  const server = createEstelaServer({
    catalog: input.target ? undefined : { index: true },
    launch: input.target,
    redacts: true,
    log: sayStoreWarning,
  })
  if (input.target) {
    try {
      await server.openLaunch()
    } catch (cause) {
      throw new CliError({ kind: 'session', action: 'load', label: sessionTargetLabel(input.target), cause })
    }
  }
  const catalog = server.catalog
  if (catalog) {
    if (catalog.indexUnavailable) {
      sayStoreWarning(`session index unavailable: ${catalog.indexUnavailable}; running without it`)
    }
    try {
      await catalog.start()
    } catch (cause) {
      throw new CliError({ kind: 'index', cause })
    }
    sayUnreadableRoots(catalog, root => sayStoreWarning(`session folder unreadable: ${unreadableRootLine(root)}`))
  }
  // Only once the start succeeded: a failed start throws above, and the process exits with its code.
  closeOnSignal(() => server.close())
  const { createMcpServer } = await import('devframe/adapters/mcp')
  await createMcpServer(server.definition, {
    transport: 'stdio',
    // DevFrame's shared-state tool would expose the browser's session signal, which tells an agent nothing.
    exposeSharedState: false,
    onReady: ({ transport }) => sayMcpReady(server.definition.id, transport),
  })
}
