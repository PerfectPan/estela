import type { ResolvedSession, TraceStore } from '@rivus/estela-rpc/trace-store'
import type { Trace } from '@rivus/estela-schema'
import type { ShellPlatform } from '../sessions/load-session.ts'
import type { Redactor } from '../sessions/redaction.ts'
import { createShellPlatform, hardenPlatform } from '../sessions/node-platform.ts'
import { serverRedaction } from '../sessions/redaction.ts'
import { createTraceStore } from '../store/trace-store.ts'

export { traceIdOf } from '../sessions/session-target.ts'

export interface EstelaCoreOptions {
  /** Reads, the home directory, and the environment. Defaults to `createShellPlatform()`. */
  platform?: ShellPlatform
  /** Redact the session text the core returns. */
  redacts: boolean
  /** Resolves trace ids: the session catalog on the dev server; a host's own ids, as the plugin's. */
  resolve?: (traceId: string) => ResolvedSession | undefined
  /** Where the TraceStore's warnings go, one line each, redacted like the store; omit to drop them. */
  log?: (line: string) => void
}

export interface EstelaCore {
  /** The hardened platform the core reads through. */
  platform: ShellPlatform
  /** The store behind view, event, and reconstruct reads. */
  store: TraceStore
  /** Make `session` the launch session (`current`) and seed the store with `trace`. */
  seed: (session: ResolvedSession, trace: Trace) => Promise<void>
  /** Text redactor that follows `redacts` (both platform and process homes when true; identity when false). */
  redact: Redactor
}

/**
 * The services of one Estela server without DevFrame and without the session catalog:
 * the hardened platform, the TraceStore, `seed`, and text redaction.
 */
export function createEstelaCore(options: EstelaCoreOptions): EstelaCore {
  const platform = options.platform ? hardenPlatform(options.platform) : createShellPlatform()
  const redaction = serverRedaction(platform.home)
  const traces = createTraceStore({
    platform,
    redacts: options.redacts,
    resolve: options.resolve,
    log: options.log,
  })
  return {
    platform,
    store: traces.store,
    seed: traces.seed,
    redact: options.redacts ? redaction.text : text => text,
  }
}
