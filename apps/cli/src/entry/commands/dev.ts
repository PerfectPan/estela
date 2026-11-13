import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { BASE_PATH, type OpenedSession, type SessionCatalog } from '@rivus/estela-server'
import { createDevServer } from 'devframe/adapters/dev'
import { createEstelaServer } from '../../server.ts'
import { CliError } from '../failure.ts'
import { openBrowser } from '../open-browser.ts'
import { sayIndexFromCache, startSessionIndex } from '../ui/index-progress.ts'
import { pickSession, sayReady, sayStart, sayStoreWarning, sayWarning, startLoad } from '../ui/terminal.ts'

export interface DevInput {
  /** The session given on the command line or in ESTELA_PATH; `label` is how the user wrote it. */
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
  /** `false` only with ESTELA_REDACT=0. */
  redacts: boolean
}

/** Who opens the browser once the server is ready, and whether DevFrame's one-time-code gate stays on. */
export interface BrowserPlan {
  /** DevFrame opens the session browser, `/__estela/`. */
  devframeOpens: boolean
  /** The CLI opens the launch session's workspace, `?s=<traceId>`. */
  cliOpens: boolean
  /** `false` turns the gate off; `undefined` keeps the definition's default, which is on. */
  auth: false | undefined
}

/**
 * DevFrame appends its one-time code to the URL fragment and re-encodes the fragment as
 * `key=value` pairs, so a `#/s/<traceId>` route cannot share it: the launch session rides
 * `?s=<traceId>` and the SPA moves it into the route. DevFrame's `openBrowser` option also
 * accepts a relative `?s=<traceId>`; the CLI opens that URL itself (`server/open-browser.ts`).
 */
export function browserPlan(input: Pick<DevInput, 'open' | 'auth'>, hasLaunchSession: boolean): BrowserPlan {
  const opens = input.open !== false
  return {
    devframeOpens: opens && !hasLaunchSession,
    cliOpens: opens && hasLaunchSession,
    auth: input.auth ? undefined : false,
  }
}

/** A session loaded before the server listens, behind the load spinner; `open` makes it `current`. */
async function loadShown(open: () => Promise<OpenedSession>, label: string): Promise<OpenedSession> {
  const loading = startLoad()
  try {
    const opened = await open()
    loading.stop(opened.trace.events.length)
    return opened
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
  const server = createEstelaServer({
    catalog: { index: input.index },
    launch: input.launch?.target,
    redacts: input.redacts,
    log: sayStoreWarning,
  })
  const catalog = server.catalog!
  if (catalog.indexUnavailable) {
    sayWarning(`Session index unavailable: ${catalog.indexUnavailable}; running without it`)
  }

  // The launch load, the index, and the picker run before the server listens, so the terminal can
  // show each one; the definition's setup then finds them done and binds the services.
  let readyTraceId: string | undefined
  if (input.launch) {
    const launched = await loadShown(async () => (await server.openLaunch())!, input.launch.label)
    readyTraceId = launched.traceId
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
    readyTraceId = (await loadShown(() => server.open(picked), 'the picked session')).traceId
  }

  const devframe = server.definition
  const plan = browserPlan(input, readyTraceId !== undefined)
  await createDevServer(devframe, {
    host: input.host,
    // Left undefined so DevFrame picks the port: it retries the next one only when no port is fixed.
    port: input.port,
    mcp: input.mcp,
    auth: plan.auth,
    openBrowser: plan.devframeOpens,
    async onReady({ origin }) {
      const base = `${origin.replace(/\/$/, '')}${BASE_PATH}`
      sayReady(readyTraceId ? `${base}#/s/${readyTraceId}` : `${base}#/`)
      if (plan.cliOpens && readyTraceId) {
        await openBrowser(base, readyTraceId, input.auth)
      }
    },
  })
}
