import { randomBytes } from 'node:crypto'
import { stripVTControlCharacters } from 'node:util'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import type { DevframeDefinition } from 'devframe'
import type { DevframeAuthHandler } from 'devframe/node/auth'
import { createAuthBanner, createInteractiveAuth, type AuthBannerInfo } from 'devframe/recipes/interactive-auth'
import { homeDir } from '@rivus/estela-runtime-node'
import { BASE_PATH, type OpenedSession, type SessionCatalog } from '@rivus/estela-server'
import { createDevServer } from 'devframe/adapters/dev'
import { createEstelaServer } from '../../server.ts'
import { closeOnSignal } from '../close-on-signal.ts'
import { CliError, isListenFailure, sanitizeInline } from '../failure.ts'
import { createServerOriginGate, dialableOrigin, secureDevframeDir, unbracketHost } from '../host.ts'
import { mcpAuthorization } from '../mcp-authorization.ts'
import { openBrowser } from '../open-browser.ts'
import { sayIndexFromCache, startSessionIndex } from '../ui/index-progress.ts'
import { pickSession, sayMcpRoute, sayReady, sayStart, sayStoreWarning, sayWarning, startLoad } from '../ui/terminal.ts'

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
  /**
   * Set only with `--mcp`, which the command line allows on a loopback host only: DevFrame's MCP route over HTTP. It
   * serves every session's content, the one-time code does not gate it, and a request needs
   * `Authorization: Bearer <token>`. `token` is ESTELA_MCP_TOKEN, or `undefined` to make one for this launch.
   */
  mcp: { token: string | undefined } | undefined
  index: boolean
  /** `false` only with ESTELA_REDACT=0. */
  redacts: boolean
}

/** Whether the CLI opens the browser once the server is ready, and whether DevFrame's one-time-code gate stays on. */
interface BrowserPlan {
  /** The CLI opens the dialable origin (and `?s=<traceId>` when launched or picked), unless `--no-open`. */
  cliOpens: boolean
  /** `false` turns the gate off; `undefined` keeps the auth handler on. */
  auth: false | undefined
}

/**
 * The CLI opens the browser itself (because DevFrame opens `localhost` for `127.0.0.1` and the
 * wildcard hosts, and re-encodes `#/s/<traceId>` fragments when appending `#devframe_otp=`).
 * Launches ride `?s=<traceId>`.
 * @internal
 */
export function browserPlan(input: Pick<DevInput, 'open' | 'auth'>): BrowserPlan {
  return {
    cliOpens: input.open !== false,
    auth: input.auth ? undefined : false,
  }
}

/**
 * Strips ANSI SGR, non-SGR escapes, newlines, controls, and bidi characters from requester banner metadata.
 * @internal
 */
export function sanitizeAuthBannerInfo(info: AuthBannerInfo): AuthBannerInfo {
  if (!info.requester) {
    return info
  }
  return {
    ...info,
    requester: {
      ua: sanitizeInline(info.requester.ua),
      origin: sanitizeInline(info.requester.origin),
    },
  }
}

/**
 * Rewrites DevFrame's resolved origin to the {@link dialableOrigin} of `host` under `BASE_PATH`.
 * @internal
 */
export function resolveAuthBannerUrl(resolvedOrigin: string, host: string): string {
  try {
    const parsed = new URL(resolvedOrigin)
    const port = parsed.port === '' ? 80 : Number(parsed.port)
    return `${dialableOrigin(host, port, parsed.origin).replace(/\/$/, '')}${BASE_PATH}`
  } catch {
    return resolvedOrigin
  }
}

/**
 * Builds a lazy auth proxy over `createInteractiveAuth`. This indirection is required because
 * `createInteractiveAuth` needs the post-`setup` `DevframeNodeContext` while `createDevServer`
 * types `auth` as `boolean | DevframeAuthHandler` (not a context callback), and DevFrame runs
 * `definition.setup` before accessing `auth.rpcFunctions` or handling requests.
 */
function createDevAuth(
  baseDefinition: DevframeDefinition,
  host: string,
): { definition: DevframeDefinition; auth: DevframeAuthHandler } {
  const baseBanner = createAuthBanner()
  let inner: DevframeAuthHandler | undefined
  const activeAuth = (): DevframeAuthHandler => {
    if (!inner) {
      throw new Error('Estela interactive auth accessed before server setup completed')
    }
    return inner
  }
  const definition: DevframeDefinition = {
    ...baseDefinition,
    async setup(ctx, info) {
      await baseDefinition.setup(ctx, info)
      inner = createInteractiveAuth(ctx, {
        serverUrl: () => resolveAuthBannerUrl(ctx.host.resolveOrigin(), host),
        banner: bannerInfo => {
          baseBanner(sanitizeAuthBannerInfo(bannerInfo))
        },
      })
    },
  }
  const auth: DevframeAuthHandler = {
    get rpcFunctions() {
      return activeAuth().rpcFunctions
    },
    authorize(methodName, session) {
      return activeAuth().authorize(methodName, session)
    },
    onConnect(connection, session) {
      activeAuth().onConnect(connection, session)
    },
    printBanner() {
      activeAuth().printBanner()
    },
    buildOpenUrl(url) {
      return activeAuth().buildOpenUrl?.(url) ?? url
    },
  }
  return { definition, auth }
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

/**
 * DevFrame's `diagnostics.DF0052(...)` prints its library-facing fix text via `console.warn`
 * before throwing; hold `[DF0052]` warnings until listening settles so a listen failure shows
 * only Estela's `CliError` message, while flushing held warnings if startup fails another way.
 * @internal
 */
export async function withoutListenDiagnostic<T>(
  run: (onListening: () => void) => Promise<T>,
  isExpectedListenError: (cause: unknown) => boolean,
): Promise<T> {
  const originalWarn = console.warn
  const held: unknown[][] = []
  let restored = false
  const restore = () => {
    if (!restored) {
      restored = true
      console.warn = originalWarn
    }
  }
  console.warn = (...args: unknown[]) => {
    const first = args[0]
    if (typeof first === 'string' && stripVTControlCharacters(first).trimStart().startsWith('[DF0052]')) {
      held.push(args)
      return
    }
    Reflect.apply(originalWarn, console, args)
  }
  let caughtListenError = false
  try {
    return await run(restore)
  } catch (cause) {
    caughtListenError = isExpectedListenError(cause)
    throw cause
  } finally {
    restore()
    if (!caughtListenError) {
      for (const args of held) {
        Reflect.apply(originalWarn, console, args)
      }
    }
  }
}

/** The local server: the session browser, the workspace of the launch or picked session, and "Export report". */
export async function runDev(input: DevInput, packageVersion: string): Promise<void> {
  sayStart(packageVersion)
  if (!input.auth) {
    sayWarning(
      'Warning: --no-auth disables the one-time auth code; any process or script on this origin can read loaded sessions.',
    )
  }
  const server = createEstelaServer({
    catalog: { index: input.index },
    launch: input.launch?.target,
    redacts: input.redacts,
    log: sayStoreWarning,
  })
  const stopClosingOnSignal = closeOnSignal(() => server.close())
  const catalog = server.catalog!
  if (catalog.indexUnavailable) {
    sayWarning(`Session index unavailable: ${catalog.indexUnavailable}; running without it`)
  }

  try {
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

    const plan = browserPlan(input)
    if (plan.auth !== false) {
      await secureDevframeDir(homeDir(), sayWarning)
    }
    const mcpToken = input.mcp === undefined ? undefined : (input.mcp.token ?? randomBytes(32).toString('base64url'))
    const originGate = createServerOriginGate(input.host)
    const bindHost = unbracketHost(input.host)
    const authSetup: { definition: DevframeDefinition; auth: false | DevframeAuthHandler } =
      plan.auth === false
        ? { definition: server.definition, auth: false }
        : createDevAuth(server.definition, input.host)
    await withoutListenDiagnostic(
      onListening =>
        createDevServer(authSetup.definition, {
          host: bindHost,
          // Left undefined so DevFrame picks the port: it retries the next one only when no port is fixed.
          port: input.port,
          // As on stdio: DevFrame's shared-state tool would expose the browser's session signal, which tells an agent nothing.
          // DevFrame's Origin gate refuses a request without Origin, which every command-line MCP client sends, so it
          // is off; `mcpAuthorization` checks the Origin a browser sends and the token.
          mcp:
            mcpToken === undefined
              ? false
              : { exposeSharedState: false, authorization: mcpAuthorization(mcpToken), allowedOrigins: false },
          auth: authSetup.auth,
          allowedOrigins: originGate.registry,
          openBrowser: false,
          async onReady({ origin, port }) {
            onListening()
            originGate.setPort(port)
            const dialable = dialableOrigin(input.host, port, origin)
            const base = `${dialable.replace(/\/$/, '')}${BASE_PATH}`
            if (mcpToken !== undefined) {
              // A token from ESTELA_MCP_TOKEN is the user's own, so it is not echoed.
              sayMcpRoute(`${base}__mcp`, input.mcp?.token === undefined ? mcpToken : undefined)
            }
            sayReady(readyTraceId ? `${base}#/s/${readyTraceId}` : `${base}#/`)
            if (plan.cliOpens) {
              await openBrowser(base, readyTraceId, input.auth)
            }
          },
        }),
      isListenFailure,
    )
  } catch (cause) {
    stopClosingOnSignal()
    server.close()
    if (cause instanceof CliError) {
      throw cause
    }
    if (isListenFailure(cause)) {
      throw new CliError({ kind: 'listen', host: input.host, port: input.port, cause })
    }
    throw cause
  }
}
