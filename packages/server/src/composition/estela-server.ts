import type { ResolvedSession, TraceStore } from '@rivus/estela-rpc'
import type { Trace } from '@rivus/estela-schema'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import type { DevframeDefinition } from 'devframe'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { bindReportExporter, bindSessionService, bindTraceStore } from '@rivus/estela-rpc'
import { SessionCatalog } from '../catalog/session-catalog.ts'
import { registerAgentTools } from '../agent-tools/register.ts'
import { exportReport } from '../report/report.ts'
import { loadSession, type ShellPlatform } from '../sessions/load-session.ts'
import { sessionTargetLabel } from '../sessions/session-target.ts'
import { createTraceStore } from '../store/trace-store.ts'
import { defineEstela, type EstelaApp } from './definition.ts'

export interface EstelaServerOptions {
  app: EstelaApp
  /** Reads, the home directory the agent roots resolve from, and the environment. Defaults to `createNodePlatform()`. */
  platform?: ShellPlatform
  /**
   * Present on the dev server: the session catalog lists and resolves every discovered session, and
   * "Export report" writes reports. Absent (`mcp`, `build`): only the launch session resolves, as `current`.
   * `index: false` runs the catalog without the session index (`--no-index`).
   */
  catalog: { index: boolean } | undefined
  /** The session that becomes `current` when the server sets up; `undefined` for none. */
  launch: SessionTarget | undefined
  /** Redact what the trace RPCs return. `mcp` and `build` always pass `true`; the dev server `false` only with ESTELA_REDACT=0. */
  redacts: boolean
  /** Where the TraceStore's warnings go, one line each, redacted like the store; omit to drop them. */
  log?: (line: string) => void
}

/** A session made `current`: its trace id and the trace loaded for it. */
export interface OpenedSession {
  traceId: string
  trace: Trace
}

export interface EstelaServer {
  /**
   * The DevFrame definition. Its `setup` in `dev` mode loads the launch session, starts the catalog,
   * binds the RPC services, and resumes the catalog's summaries; each step that already ran is not
   * repeated, so a caller may run them first (the CLI does, to show progress before the server listens).
   */
  definition: DevframeDefinition
  /** The session catalog when `catalog` is set. `start(onProgress)` before setup reports the first discover pass. */
  catalog: SessionCatalog | undefined
  /** The store behind `load-trace`, `get-trace-view`, `get-event`, and `reconstruct`; `build` reads its report from it. */
  store: TraceStore
  /** Loads the launch session once and makes it `current`; `undefined` without one. Throws the load's error. */
  openLaunch: () => Promise<OpenedSession | undefined>
  /** Loads the catalog session `traceId` and makes it `current`. Throws when it does not resolve or does not load. */
  open: (traceId: string) => Promise<OpenedSession>
  /** Flushes and closes the session index. Call after the server stops. */
  close: () => void
}

/**
 * The Estela server's services and the DevFrame definition that binds them: session reading
 * through the kit, the session catalog, the TraceStore, and the report writer. Every entry point
 * (the CLI's `dev`, `build`, and `mcp`, or a DevFrame hub that runs only `setup`) starts here.
 * The RPC bindings are module state in `@rivus/estela-rpc`, so one process serves one Estela server.
 */
export function createEstelaServer(options: EstelaServerOptions): EstelaServer {
  const platform = options.platform ?? createNodePlatform()
  // Summaries wait until setup: the server listens before they compete with it.
  const catalog = options.catalog
    ? new SessionCatalog({ platform, noIndex: !options.catalog.index, deferSummaries: true })
    : undefined
  const traces = createTraceStore({
    platform,
    redacts: options.redacts,
    resolve: catalog ? traceId => catalog.resolve(traceId) : undefined,
    log: options.log,
  })

  const make = async (session: ResolvedSession, trace: Trace): Promise<OpenedSession> => {
    await traces.seed(session, trace)
    return { traceId: session.key, trace }
  }

  const loadLaunch = async (target: SessionTarget): Promise<OpenedSession> => {
    const trace = await loadSession(target, { platform })
    // With a catalog the key is the file's list-row trace id, so `current` and the row share one
    // cache entry; without one only `current` resolves, keyed by the `path#id` string.
    const key = catalog ? catalog.openPath(target, trace) : sessionTargetLabel(target)
    return make({ key, target }, trace)
  }

  let launched: Promise<OpenedSession | undefined> | undefined
  const openLaunch = (): Promise<OpenedSession | undefined> => {
    launched ??= options.launch ? loadLaunch(options.launch) : Promise.resolve(undefined)
    return launched
  }

  const open = async (traceId: string): Promise<OpenedSession> => {
    const session = catalog?.resolve(traceId)
    if (!session) {
      throw new Error(`no session has the trace id ${traceId}`)
    }
    return make(session, await loadSession(session.target, { platform }))
  }

  const definition: DevframeDefinition = defineEstela(options.app, async ctx => {
    await openLaunch()
    bindTraceStore(traces.store)
    if (catalog) {
      await catalog.start()
      bindSessionService({ listSessions: query => catalog.listSessions(query) })
      bindReportExporter(query => exportReport(definition, traces.store, query))
      catalog.resumeSummaries()
    }
    registerAgentTools(ctx.agent, { store: traces.store, catalog, home: platform.home })
  })

  return {
    definition,
    catalog,
    store: traces.store,
    openLaunch,
    open,
    close: () => catalog?.close(),
  }
}
