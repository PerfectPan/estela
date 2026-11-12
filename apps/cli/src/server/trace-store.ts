import type { Trace } from '@rivus/estela-schema'
import type { ResolvedSession } from '@rivus/estela-rpc'
import { isCanonicalTraceFile } from '@rivus/estela-kernel'
import { redact } from '@rivus/agent-kit/redact'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { readOriginal, type ReadOriginalError, type SessionAdapters } from '@rivus/agent-kit/sessions'
import { CURRENT_TRACE_ID, TraceStore } from '@rivus/estela-rpc'
import { homeDir } from '@rivus/estela-runtime-node'
import { loadSession, type ShellPlatform } from '../sessions/load-session.ts'

export interface TraceStoreOptions {
  /** Defaults to `createNodePlatform()`. */
  platform?: ShellPlatform
  /** Omit to use the kit's built-in session services. */
  adapters?: SessionAdapters
  redacts: boolean
  /** Other trace ids: on the dev server, the session catalog (every list row and the launch session's row trace id). */
  resolve?: (traceId: string) => ResolvedSession | undefined
  /** Where the store's warnings go, one line each and redacted like the store; omit to drop them. */
  log?: (line: string) => void
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

/** Map all expected kit original-read failures at the CLI boundary. */
function originalFailure(error: ReadOriginalError): string {
  switch (error._tag) {
    case 'ReadFailed':
      return error.message
    case 'SourceChanged':
      return 'the source changed since it was loaded'
    case 'SessionNotFound':
      return 'the session no longer exists'
  }
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
  const log = options.log
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
        throw new Error(originalFailure(read.error))
      }
      return read.value
    },
    present: options.redacts ? value => redact(value, { home }) : undefined,
    log: log ? message => log(options.redacts ? redact(message, { home }) : message) : undefined,
  })
  return {
    store,
    seed: async (session, trace) => {
      current = session
      await store.seed(session, { trace, canonical: await canonicalOf(session) })
    },
  }
}
