import { resolve } from 'node:path'
import process from 'node:process'
import { splitSessionRef } from '@rivus/agent-trace-kernel'
import { bindSessionService } from '@rivus/agent-trace-rpc'
import { homeDir } from '@rivus/agent-trace-runtime-node'
import { createBuild } from 'devframe/adapters/build'
import { createCac } from 'devframe/adapters/cac'
import pkg from '../package.json' with { type: 'json' }
import { parseCommand, programArgv, wantsUsage } from './argv.ts'
import { createCatalog } from './catalog.ts'
import devframe, { BASE_PATH } from './devframe.ts'
import { openBrowser } from './open-browser.ts'
import { demoFixturePath } from './paths.ts'
import { Session } from './session.ts'
import { installPlainFilter, pickSession, sayBuild, sayError, sayReady, sayStart, startLoad } from './terminal.ts'
import { sayIndexFromCache, startSessionIndex } from './terminal-index.ts'

const FIX = 'Pass a canonical agent-trace JSON file, or a session path a registered host accepts.'

function normalizeSessionPath(input: string): string {
  const { file, sessionId } = splitSessionRef(input)
  const resolved = resolve(file)
  return sessionId === undefined ? resolved : `${resolved}#${sessionId}`
}

export async function main(): Promise<void> {
  const parsed = parseCommand(process.argv)
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n`)
    process.exit(1)
  }
  if (parsed.command === 'mcp' && parsed.pick) {
    process.stderr.write('--pick cannot be used with mcp\n')
    process.exit(1)
  }
  if (parsed.command === 'mcp')
    installPlainFilter({ stderrOnly: true, homeDir: homeDir() })
  else
    installPlainFilter({ homeDir: homeDir() })

  if (parsed.pick && !process.stdin.isTTY) {
    process.stderr.write('--pick needs an interactive terminal\n')
    process.exit(1)
  }

  let readyRef: string | undefined
  let readyHook: (() => void) | undefined
  let openRef = false
  const handle = createCac(devframe, {
    async onReady({ origin }) {
      readyHook?.()
      const base = `${origin.replace(/\/$/, '')}${BASE_PATH}`
      sayReady(readyRef ? `${base}#/s/${readyRef}` : `${base}#/`)
      if (openRef && readyRef)
        await openBrowser(base, readyRef, !parsed.userArgs.includes('--no-auth'))
    },
  })

  if (wantsUsage(parsed.userArgs)) {
    await handle.parse(programArgv(parsed.userArgs))
    return
  }

  if (parsed.command === 'mcp' || parsed.command === 'build') {
    const sessionPath = normalizeSessionPath(parsed.path ?? process.env.AGENT_TRACE_PATH ?? demoFixturePath())
    const session = new Session(sessionPath, true)
    bindSessionService(session)
    if (parsed.command === 'mcp') {
      await loadOrExit(session, { mcp: true })
      await handle.parse(programArgv(parsed.userArgs))
      return
    }
    const outDir = parsed.outDir ?? 'dist-static'
    try {
      await sayBuild(pkg.version, {
        load: async () => {
          const trace = await session.load()
          return `${trace.events.length} events`
        },
        redact: async () => {
          const view = await session.view()
          return `redacted ${view.trace.events.length} events`
        },
        write: async () => {
          await createBuild(devframe, { outDir, pretty: parsed.pretty })
          return outDir
        },
      })
    }
    catch (error) {
      sayError(`Could not build ${session.path}: ${messageOf(error)}`, FIX)
      process.exit(1)
    }
    return
  }

  sayStart(pkg.version)
  const catalog = createCatalog({ noIndex: parsed.noIndex, deferSummaries: true })
  bindSessionService(catalog)
  readyHook = () => catalog.resumeSummaries()

  const direct = parsed.pick ? undefined : (parsed.path ?? process.env.AGENT_TRACE_PATH)
  if (direct) {
    const loading = startLoad()
    try {
      readyRef = await catalog.openPath(normalizeSessionPath(direct))
      const view = await catalog.view()
      loading.stop(view.trace.events.length)
    }
    catch (error) {
      loading.cancel()
      sayError(`Could not load ${direct}: ${messageOf(error)}`, FIX)
      process.exit(1)
    }
  }

  const indexing = startSessionIndex()
  try {
    await catalog.start((hosts) => {
      if (!catalog.startedFromIndex)
        indexing.tick(hosts)
    })
    if (catalog.startedFromIndex) {
      const listed = await catalog.listSessions()
      sayIndexFromCache(listed.hosts.map(host => ({ name: host.displayName, count: host.count })))
    }
    else {
      indexing.finish()
    }
  }
  catch (error) {
    indexing.cancel()
    sayError(`Could not index sessions: ${messageOf(error)}`, 'Check the host directories, or pass --no-index.')
    process.exit(1)
  }

  if (parsed.pick) {
    await catalog.discovered()
    const options = catalog.pickChoices()
    if (options.length === 0) {
      sayError('No sessions to pick.', FIX)
      process.exit(1)
    }
    readyRef = await pickSession(options)
    const loading = startLoad()
    try {
      const view = await catalog.sessionTrace(readyRef)
      loading.stop(view.trace.events.length)
    }
    catch (error) {
      loading.cancel()
      sayError(`Could not load the picked session: ${messageOf(error)}`, FIX)
      process.exit(1)
    }
  }

  // DevFrame opens `/__agent-trace/` and puts its one-time code in the fragment, so it
  // cannot open `#/s/<ref>` itself. With a session, the shell opens the browser instead.
  const userArgs = parsed.userArgs.filter(arg => arg !== '--open')
  if (readyRef && !userArgs.includes('--no-open')) {
    openRef = true
    userArgs.push('--no-open')
  }
  await handle.parse(programArgv(userArgs))
}

async function loadOrExit(session: Session, options?: { mcp?: boolean, cancel?: () => void }) {
  try {
    return await session.load()
  }
  catch (error) {
    options?.cancel?.()
    const text = `Could not load ${session.path}: ${messageOf(error)}`
    if (options?.mcp) {
      process.stderr.write(`${text}\n${FIX}\n`)
      process.exit(1)
    }
    sayError(text, FIX)
    process.exit(1)
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error && error.cause.message)
    return `${error.message}: ${error.cause.message}`
  return error instanceof Error ? error.message : String(error)
}
