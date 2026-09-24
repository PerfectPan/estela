import type { Trace } from '@rivus/agent-trace-schema'
import { isStaticBuild, scopedClient } from '@/shell/client.ts'

export interface WorkspaceTrace {
  trace: Trace
  /** Reads one event's `original` back from its source; absent in a static build, whose trace keeps originals. */
  original?: (id: string) => Promise<unknown>
}

/**
 * The trace for the workspace route. Live: the view trace from `get-trace-view(ref)` (strings
 * capped, no originals) and `get-event(ref, id)` for an original. A static build has no session
 * list and bakes one argument-free `get-trace` snapshot. M4b adds `load-trace` progress.
 */
export async function fetchTrace(ref: string): Promise<WorkspaceTrace> {
  const ctx = await scopedClient()
  if (!ref || await isStaticBuild())
    return { trace: (await ctx.rpc.call('get-trace')).trace }
  const view = await ctx.rpc.call('get-trace-view', { ref })
  return {
    trace: view.trace,
    original: async (id) => {
      const event = await ctx.rpc.call('get-event', { ref, id })
      // The reason, when the source changed since the load or cannot be read.
      return event.originalUnavailable ?? event.original
    },
  }
}
