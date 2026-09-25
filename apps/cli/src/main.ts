import type { ReportTrace, ResolvedSession } from '@rivus/agent-trace-rpc'
import type { Trace } from '@rivus/agent-trace-schema'
import { resolve } from 'node:path'
import process from 'node:process'
import { loadTrace, splitSessionRef } from '@rivus/agent-trace-kernel'
import { bindReportExporter, bindSessionService, bindTraceStore, CURRENT_REF } from '@rivus/agent-trace-rpc'
import { homeDir, nodeIO } from '@rivus/agent-trace-runtime-node'
import { createCac } from 'devframe/adapters/cac'
import pkg from '../package.json' with { type: 'json' }
import { parseCommand, programArgv, wantsUsage } from './argv.ts'
import { SessionCatalog } from './catalog.ts'
import devframe, { BASE_PATH } from './devframe.ts'
import { openBrowser } from './open-browser.ts'
import { demoFixturePath } from './paths.ts'
import { exportReport, reportOf, writeReport } from './report.ts'
import { registeredHosts, sessionLoader } from './session.ts'
import { createTraceStore } from './trace-store.ts'
import { installPlainFilter, pickSession, sayBuild, sayError, sayReady, sayStart, sayWarning, startLoad } from './terminal.ts'
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
    // `build` and `mcp` always redact; only the local server honors `AGENT_TRACE_REDACT=0`.
    const sessionPath = normalizeSessionPath(parsed.path ?? process.env.AGENT_TRACE_PATH ?? demoFixturePath())
    const current: ResolvedSession = { key: sessionPath, path: sessionPath }
    const load = sessionLoader(sessionPath)
    const traces = createTraceStore({ adapters: registeredHosts, redacts: true })
    bindTraceStore(traces.store)
    if (parsed.command === 'mcp') {
      await traces.seed(current, await loadOrExit(load, sessionPath))
      await handle.parse(programArgv(parsed.userArgs))
      return
    }
    const outDir = parsed.outDir ?? 'dist-static'
    let report: ReportTrace | undefined
    try {
      await sayBuild(pkg.version, {
        load: async () => {
          const trace = await load()
          // One load per build: the store gets this trace, so nothing reads the file again.
          await traces.seed(current, trace)
          return `${trace.events.length} events`
        },
        redact: async () => {
          const byId = new Map((await load()).events.map(event => [event.id, event]))
          report = await reportOf(traces.store, CURRENT_REF, async ids => ids.map(id => byId.get(id)!))
          const included = report.truncated ? `; original records for the first ${report.events.length}` : ''
          return `redacted ${report.total} events${included}`
        },
        write: async () => {
          await writeReport(outDir, report!)
          return outDir
        },
      })
    }
    catch (error) {
      sayError(`Could not build ${sessionPath}: ${messageOf(error)}`, FIX)
      process.exit(1)
    }
    return
  }

  sayStart(pkg.version)
  const redacts = process.env.AGENT_TRACE_REDACT !== '0'
  const catalog = new SessionCatalog({ noIndex: parsed.noIndex, deferSummaries: true })
  const traces = createTraceStore({ adapters: registeredHosts, redacts, resolve: ref => catalog.resolve(ref) })
  bindTraceStore(traces.store)
  bindSessionService({ listSessions: input => catalog.listSessions(input) })
  bindReportExporter(input => exportReport(traces.store, input))
  readyHook = () => catalog.resumeSummaries()
  if (catalog.indexUnavailable)
    sayWarning(`Session index unavailable: ${catalog.indexUnavailable}; running without it`)

  const direct = parsed.pick ? undefined : (parsed.path ?? process.env.AGENT_TRACE_PATH)
  if (direct) {
    const path = normalizeSessionPath(direct)
    const trace = await loadLaunch(path, `Could not load ${direct}`)
    readyRef = catalog.openPath(path, trace)
    await traces.seed({ key: readyRef, path }, trace)
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
    const picked = catalog.resolve(readyRef)!
    const trace = await loadLaunch(picked.path, 'Could not load the picked session')
    await traces.seed(picked, trace)
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

/** The dev server's launch session, loaded once before it listens; it seeds the TraceStore. */
async function loadLaunch(target: ResolvedSession['path'], failure: string): Promise<Trace> {
  const loading = startLoad()
  try {
    const trace = await loadTrace(target, registeredHosts, nodeIO)
    loading.stop(trace.events.length)
    return trace
  }
  catch (error) {
    loading.cancel()
    sayError(`${failure}: ${messageOf(error)}`, FIX)
    process.exit(1)
  }
}

/** `mcp` writes only to stderr: stdout carries the protocol. */
async function loadOrExit(load: () => Promise<Trace>, path: string): Promise<Trace> {
  try {
    return await load()
  }
  catch (error) {
    process.stderr.write(`Could not load ${path}: ${messageOf(error)}\n${FIX}\n`)
    process.exit(1)
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error && error.cause.message)
    return `${error.message}: ${error.cause.message}`
  return error instanceof Error ? error.message : String(error)
}
