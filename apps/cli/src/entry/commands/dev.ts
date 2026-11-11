import type { Trace } from '@rivus/agent-trace-schema'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { bindReportExporter, bindSessionService, bindTraceStore } from '@rivus/agent-trace-rpc'
import { createDevServer, resolveDevServerPort } from 'devframe/adapters/dev'
import { SessionCatalog } from '../../catalog/session-catalog.ts'
import { exportReport } from '../../report/report.ts'
import devframe, { BASE_PATH } from '../../server/devframe.ts'
import { openBrowser } from '../../server/open-browser.ts'
import { createTraceStore } from '../../server/trace-store.ts'
import { loadSession, type ShellPlatform } from '../../sessions/load-session.ts'
import { CliError } from '../failure.ts'
import { sayIndexFromCache, startSessionIndex } from '../ui/index-progress.ts'
import { pickSession, sayReady, sayStart, sayStoreWarning, sayWarning, startLoad } from '../ui/terminal.ts'

export interface DevInput {
  /** The session given on the command line or in AGENT_TRACE_PATH; `label` is how the user wrote it. */
  launch: { target: SessionTarget; label: string } | undefined
  pick: boolean
  /** `undefined`: the definition's port, or the next free one. */
  port: number | undefined
  host: string
  /** `undefined` opens the browser, as `true` does; only `--no-open` keeps it closed. */
  open: boolean | undefined
  auth: boolean
  /** `undefined`: DevFrame mounts the MCP route once agent tools exist. */
  mcp: boolean | undefined
  index: boolean
  /** `false` only with AGENT_TRACE_REDACT=0. */
  redacts: boolean
}

/** Who opens the browser once the server is ready, and whether DevFrame's one-time-code gate stays on. */
export interface BrowserPlan {
  /** DevFrame opens the session browser, `/__agent-trace/`. */
  devframeOpens: boolean
  /** The CLI opens the launch session's workspace, `?s=<traceId>`. */
  cliOpens: boolean
  /** `false` turns the gate off; `undefined` keeps the definition's default, which is on. */
  auth: false | undefined
}

/**
 * DevFrame opens `/__agent-trace/` and puts its one-time code in the fragment, so it cannot open
 * `#/s/<traceId>` itself: with a launch session the CLI opens the browser instead.
 */
export function browserPlan(input: Pick<DevInput, 'open' | 'auth'>, hasLaunchSession: boolean): BrowserPlan {
  const opens = input.open !== false
  return {
    devframeOpens: opens && !hasLaunchSession,
    cliOpens: opens && hasLaunchSession,
    auth: input.auth ? undefined : false,
  }
}

/** The launch session, loaded once before the server listens; it seeds the TraceStore. */
async function loadLaunch(platform: ShellPlatform, target: SessionTarget, label: string): Promise<Trace> {
  const loading = startLoad()
  try {
    const trace = await loadSession(target, { platform })
    loading.stop(trace.events.length)
    return trace
  } catch (cause) {
    loading.cancel()
    throw new CliError({ kind: 'session', action: 'load', label, cause })
  }
}

/** Rows from the index at once when it has them, else after the first `discover` pass. */
async function indexSessions(catalog: SessionCatalog): Promise<void> {
  const indexing = startSessionIndex()
  try {
    await catalog.start(agents => {
      if (!catalog.startedFromIndex) {
        indexing.tick(agents)
      }
    })
    if (catalog.startedFromIndex) {
      const listed = await catalog.listSessions()
      sayIndexFromCache(listed.agents.map(agent => ({ name: agent.displayName, count: agent.count })))
    } else {
      indexing.finish()
    }
  } catch (cause) {
    indexing.cancel()
    throw new CliError({ kind: 'index', cause })
  }
}

/** The local server: the session browser, the workspace of the launch or picked session, and "Export report". */
export async function runDev(input: DevInput, packageVersion: string): Promise<void> {
  sayStart(packageVersion)
  const platform = createNodePlatform()
  const catalog = new SessionCatalog({ platform, noIndex: !input.index, deferSummaries: true })
  const traces = createTraceStore({
    platform,
    redacts: input.redacts,
    resolve: traceId => catalog.resolve(traceId),
    log: sayStoreWarning,
  })
  bindTraceStore(traces.store)
  bindSessionService({ listSessions: query => catalog.listSessions(query) })
  bindReportExporter(query => exportReport(traces.store, query))
  if (catalog.indexUnavailable) {
    sayWarning(`Session index unavailable: ${catalog.indexUnavailable}; running without it`)
  }

  let readyTraceId: string | undefined
  if (input.launch) {
    const trace = await loadLaunch(platform, input.launch.target, input.launch.label)
    readyTraceId = catalog.openPath(input.launch.target, trace)
    await traces.seed({ key: readyTraceId, target: input.launch.target }, trace)
  }

  await indexSessions(catalog)

  if (input.pick) {
    await catalog.discovered()
    const choices = catalog.pickChoices()
    if (choices.length === 0) {
      throw new CliError({ kind: 'no-sessions' })
    }
    const picked = await pickSession(choices)
    if (picked === undefined) {
      throw new CliError({ kind: 'cancelled' })
    }
    const session = catalog.resolve(picked)!
    const trace = await loadLaunch(platform, session.target, 'the picked session')
    await traces.seed(session, trace)
    readyTraceId = picked
  }

  const plan = browserPlan(input, readyTraceId !== undefined)
  await createDevServer(devframe, {
    host: input.host,
    port: input.port ?? (await resolveDevServerPort(devframe, { host: input.host })),
    mcp: input.mcp,
    auth: plan.auth,
    openBrowser: plan.devframeOpens,
    async onReady({ origin }) {
      catalog.resumeSummaries()
      const base = `${origin.replace(/\/$/, '')}${BASE_PATH}`
      sayReady(readyTraceId ? `${base}#/s/${readyTraceId}` : `${base}#/`)
      if (plan.cliOpens && readyTraceId) {
        await openBrowser(base, readyTraceId, input.auth)
      }
    },
  })
}
