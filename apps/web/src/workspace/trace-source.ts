import type { TraceView } from '@rivus/agent-trace-rpc'
import { isStaticBuild, scopedClient } from '@/shell/client.ts'

/**
 * The trace for the workspace route. Live: `session-trace(ref)`. A static build has no
 * session list and bakes one argument-free `get-trace` snapshot. M4 replaces both with
 * `get-trace-view(ref)`.
 */
export async function fetchTrace(ref: string): Promise<TraceView> {
  const ctx = await scopedClient()
  if (!ref || await isStaticBuild())
    return ctx.rpc.call('get-trace')
  return ctx.rpc.call('session-trace', { ref })
}
