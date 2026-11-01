import type { Trace } from '@rivus/agent-trace-schema'
import type { ResolvedSession } from '@rivus/agent-trace-rpc'
import process from 'node:process'
import { isCanonicalTraceFile } from '@rivus/agent-trace-kernel'
import { redact } from '@rivus/agent-kit/redact'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { readOriginal, type SessionAdapters } from '@rivus/agent-kit/sessions'
import { CURRENT_TRACE_ID, TraceStore } from '@rivus/agent-trace-rpc'
import { homeDir } from '@rivus/agent-trace-runtime-node'
import type { CatalogPlatform } from './catalog-rows.ts'
import { loadSession } from './session.ts'

export interface TraceStoreOptions {
  /** Defaults to `createNodePlatform()`. */
  platform?: CatalogPlatform
  /** Omit to use the kit's built-in session services. */
  adapters?: SessionAdapters
  redacts: boolean
  /** Other trace ids: on the dev server, the session catalog (every list row and the launch session's row trace id). */
  resolve?: (traceId: string) => ResolvedSession | undefined
}

export interface ShellTraceStore {
  store: TraceStore
  /**
   * Make `session` the launch session (resolved from `CURRENT_TRACE_ID`) and cache the trace the
   * CLI already loaded for it. On the dev server its key is the catalog's trace id, so `current` and
   * the list row share one cache entry.
   */
  seed: (session: ResolvedSession, trace: Trace) => Promise<void>
}

/** Store for `get-trace-view`, `get-event`, and `reconstruct` over Node file I/O. */
export function createTraceStore(options: TraceStoreOptions): ShellTraceStore {
  const home = homeDir()
  const platform = options.platform ?? createNodePlatform()
  // The store's stat and source-pointer reads (`stampFiles`, `checkedOriginal`, `totalBytes`)
  // and the canonical fast path (`canonicalOf`, `loadSession`) all read through the platform.
  const fs = platform.fs
  const canonicalOf = (session: ResolvedSession): Promise<boolean> => isCanonicalTraceFile(session.target.path, fs)
  let current: ResolvedSession | undefined
  const store = new TraceStore({
    resolve: traceId => (traceId === CURRENT_TRACE_ID ? current : options.resolve?.(traceId)),
    fs,
    async load(session, opts) {
      const [trace, canonical] = await Promise.all([
        loadSession(session.target, {
          platform,
          ...(options.adapters ? { adapters: options.adapters } : {}),
          signal: opts.signal,
          onProgress: opts.onProgress,
        }),
        canonicalOf(session),
      ])
      return { trace, canonical }
    },
    readOriginal: async source => {
      const read = await readOriginal(platform, source)
      if (!read.ok) {
        const error = read.error
        throw new Error(
          error._tag === 'ReadFailed'
            ? error.message
            : error._tag === 'SourceChanged'
              ? 'the source changed since it was loaded'
              : 'the session no longer exists',
        )
      }
      return read.value
    },
    present: options.redacts ? value => redact(value, { home }) : undefined,
    log: message => process.stderr.write(`agent-trace: ${options.redacts ? redact(message, { home }) : message}\n`),
  })
  return {
    store,
    seed: async (session, trace) => {
      current = session
      await store.seed(session, { trace, canonical: await canonicalOf(session) })
    },
  }
}
