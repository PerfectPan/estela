import type { Trace } from '@rivus/agent-trace-schema'
import type { HostAdapter } from '@rivus/agent-trace-kernel'
import type { ResolvedSession } from '@rivus/agent-trace-rpc'
import process from 'node:process'
import { isCanonicalTraceFile, loadTrace } from '@rivus/agent-trace-kernel'
import { redact } from '@rivus/agent-kit/redact'
import { CURRENT_REF, TraceStore } from '@rivus/agent-trace-rpc'
import { homeDir, nodeIO } from '@rivus/agent-trace-runtime-node'

export interface TraceStoreOptions {
  adapters: readonly HostAdapter[]
  redacts: boolean
  /** Other refs: on the dev server, the session catalog (every list row and the launch session's row ref). */
  resolve?: (ref: string) => ResolvedSession | undefined
}

export interface ShellTraceStore {
  store: TraceStore
  /**
   * Make `session` the launch session (resolved from `CURRENT_REF`) and cache the trace the
   * CLI already loaded for it. On the dev server its key is the catalog ref, so `current` and
   * the list row share one cache entry.
   */
  seed: (session: ResolvedSession, trace: Trace) => Promise<void>
}

function canonicalOf(path: ResolvedSession['path']): Promise<boolean> {
  return isCanonicalTraceFile(typeof path === 'string' ? path : path.path, nodeIO)
}

/** Store for `get-trace-view`, `get-event`, and `reconstruct` over Node file I/O. */
export function createTraceStore(options: TraceStoreOptions): ShellTraceStore {
  const home = homeDir()
  let current: ResolvedSession | undefined
  const store = new TraceStore({
    resolve: ref => (ref === CURRENT_REF ? current : options.resolve?.(ref)),
    io: nodeIO,
    async load(session, opts) {
      const [trace, canonical] = await Promise.all([
        loadTrace(session.path, options.adapters, nodeIO, opts),
        canonicalOf(session.path),
      ])
      return { trace, canonical }
    },
    present: options.redacts ? value => redact(value, { home }) : undefined,
    log: message => process.stderr.write(`agent-trace: ${options.redacts ? redact(message, { home }) : message}\n`),
  })
  return {
    store,
    seed: async (session, trace) => {
      current = session
      await store.seed(session, { trace, canonical: await canonicalOf(session.path) })
    },
  }
}
