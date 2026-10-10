import type { Trace } from '@rivus/agent-trace-schema'
import type { ResolvedSession } from '@rivus/agent-trace-rpc'
import process from 'node:process'
import { isCanonicalTraceFile } from '@rivus/agent-trace-kernel'
import { redact } from '@rivus/agent-kit/redact'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { builtinSessionAdapters, type SessionAdapters } from '@rivus/agent-kit/sessions'
import { CURRENT_REF, TraceStore } from '@rivus/agent-trace-rpc'
import { homeDir, nodeIO } from '@rivus/agent-trace-runtime-node'
import type { CatalogPlatform } from './catalog-rows.ts'
import { loadSession } from './session.ts'

export interface TraceStoreOptions {
  /** Defaults to `createNodePlatform()`. */
  platform?: CatalogPlatform
  /** Defaults to `builtinSessionAdapters`. */
  adapters?: SessionAdapters
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
  const platform = options.platform ?? createNodePlatform()
  let current: ResolvedSession | undefined
  const store = new TraceStore({
    resolve: ref => (ref === CURRENT_REF ? current : options.resolve?.(ref)),
    // `io` serves the source-pointer reads (`checkedOriginal`) only; session loads go through
    // the kit platform. Both stay until 2b moves the reads onto the platform.
    io: nodeIO,
    async load(session, opts) {
      const [trace, canonical] = await Promise.all([
        loadSession(session.path, {
          platform,
          adapters: options.adapters ?? builtinSessionAdapters,
          signal: opts.signal,
          onProgress: opts.onProgress,
        }),
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
