import type { ReportTrace, ResolvedSession, ServerServices, TraceStore } from '@rivus/estela-rpc'
import type { Trace } from '@rivus/estela-schema'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import type { DevframeDefinition } from 'devframe'
import {
  createReportFunctions,
  createReportSource,
  createServerFunctions,
  createSessionPublisher,
} from '@rivus/estela-rpc'
import { SessionCatalog } from '../catalog/session-catalog.ts'
import { registerAgentTools } from '../agent-tools/register.ts'
import { createReportQueue, exportReport, writeReport } from '../report/report.ts'
import { loadSession, type ShellPlatform } from '../sessions/load-session.ts'
import { serverRedaction } from '../sessions/redaction.ts'
import { createShellPlatform, hardenPlatform } from '../sessions/node-platform.ts'
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
  /**
   * Redact the session text the server returns: what the trace RPCs return, and the catalog's list rows and
   * picker labels (titles, projects, prompts). `mcp` and `build` always pass `true`; the dev server passes
   * `false` only with `ESTELA_REDACT=0`. Reports, MCP tool results, and what names a path redact whatever
   * this says.
   */
  redacts: boolean
  /**
   * Where "Export report" creates each report's new directory (`estela-report-<traceId>-<time>`): a host's own,
   * since its working directory is not one its user chose. The working directory when omitted; it must exist.
   */
  reportDir?: string
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
   * resumes the catalog's summaries, registers the agent tools, and binds this server's session publisher;
   * each step that already ran is not repeated, so a caller may run them first (the CLI does, to show
   * progress before the server listens).
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
  /** Writes one redacted report directory (`index.html`), serialized on this server's report queue. */
  writeReport: (outDir: string, report: ReportTrace) => Promise<void>
  /**
   * Stops the catalog and closes the session index: no summary starts after it, and one still running ends
   * without a write or a push. Call after the server stops.
   */
  close: () => void
}

/**
 * The Estela server's services and the DevFrame definition that registers them: session reading
 * through the kit, the session catalog, the TraceStore, and the report writer. Every entry point
 * (the CLI's `dev`, `build`, and `mcp`, or a DevFrame hub that runs only `setup`) starts here.
 * Each server owns its own RPC function definitions, session publisher, and report queue.
 */
export function createEstelaServer(options: EstelaServerOptions): EstelaServer {
  const platform = options.platform ? hardenPlatform(options.platform) : createShellPlatform()
  const publisher = createSessionPublisher()
  const reportSource = createReportSource()
  const reportQueue = createReportQueue()
  // Summaries wait until setup: the server listens before they compete with it.
  const catalog = options.catalog
    ? new SessionCatalog({
        platform,
        noIndex: !options.catalog.index,
        deferSummaries: true,
        redacts: options.redacts,
        announce: signal => publisher.emit(signal),
      })
    : undefined
  const traces = createTraceStore({
    platform,
    redacts: options.redacts,
    resolve: catalog ? traceId => catalog.resolve(traceId) : undefined,
    log: options.log,
  })
  // The redaction that is always on: reports, MCP tool results, and what names a path.
  const redact = serverRedaction(platform.home)

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

  // `exportReport` runs DevFrame's build on the same definition that registers it.
  let builtDefinition: DevframeDefinition | undefined
  const services: ServerServices = {
    store: traces.store,
    listSessions: catalog ? query => catalog.listSessions(query) : undefined,
    exportReport: catalog
      ? query =>
          exportReport(builtDefinition!, reportSource, reportQueue, traces.store, query, {
            dir: options.reportDir,
            redact,
          })
      : undefined,
    reportSource,
  }
  const serverFunctions = createServerFunctions(services)
  const reportFunctions = createReportFunctions(services)

  const definition: DevframeDefinition = defineEstela(options.app, serverFunctions, reportFunctions, {
    publisher,
    setup: async ctx => {
      await openLaunch()
      if (catalog) {
        await catalog.start()
        catalog.resumeSummaries()
      }
      registerAgentTools(ctx.agent, { store: traces.store, catalog, redact })
    },
  })
  builtDefinition = definition

  return {
    definition,
    catalog,
    store: traces.store,
    openLaunch,
    open,
    writeReport: (outDir, report) => writeReport(definition, reportSource, reportQueue, outDir, report),
    close: () => catalog?.close(),
  }
}
