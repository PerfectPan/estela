import type { ReportTrace, ResolvedSession } from '@rivus/agent-trace-rpc'
import type { Trace } from '@rivus/agent-trace-schema'
import { resolve } from 'node:path'
import process from 'node:process'
import { bindReportExporter, bindSessionService, bindTraceStore, CURRENT_TRACE_ID } from '@rivus/agent-trace-rpc'
import { homeDir } from '@rivus/agent-trace-runtime-node'
import { createNodePlatform } from '@rivus/agent-kit/node'
import type { Platform } from '@rivus/agent-kit/platform'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { createCac } from 'devframe/adapters/cac'
import pkg from '../package.json' with { type: 'json' }
import { parseCommand, programArgv, wantsUsage } from './argv.ts'
import { SessionCatalog } from './catalog.ts'
import devframe, { BASE_PATH } from './devframe.ts'
import { writeExport, type ExportFormat } from './export.ts'
import { openBrowser } from './open-browser.ts'
import { demoFixturePath } from './paths.ts'
import { exportReport, reportOf, writeReport } from './report.ts'
import { loadSession, sessionLoader } from './session.ts'
import { parseSessionTarget, sessionTargetLabel } from './session-target.ts'
import { createTraceStore } from './trace-store.ts'
import {
  installPlainFilter,
  pickSession,
  sayBuild,
  sayError,
  sayReady,
  sayStart,
  sayWarning,
  startLoad,
} from './terminal.ts'
import { sayIndexFromCache, startSessionIndex } from './terminal-index.ts'

const FIX = 'Pass a canonical agent-trace JSON file, or a session path a registered agent adapter accepts.'

/** The target of a session given on the command line (`path` or `path#sessionId`), its path made absolute. */
function sessionTargetOf(input: string): SessionTarget {
  const target = parseSessionTarget(input)
  return { ...target, path: resolve(target.path) }
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.cause instanceof Error && error.cause.message) {
    return `${error.message}: ${error.cause.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

/** The dev server's launch session, loaded once before it listens; it seeds the TraceStore. */
async function loadLaunch(platform: Platform, target: SessionTarget, failure: string): Promise<Trace> {
  const loading = startLoad()
  try {
    const trace = await loadSession(target, { platform })
    loading.stop(trace.events.length)
    return trace
  } catch (error) {
    loading.cancel()
    sayError(`${failure}: ${messageOf(error)}`, FIX)
    process.exit(1)
  }
}

/** `mcp` writes only to stderr: stdout carries the protocol. */
async function loadOrExit(load: () => Promise<Trace>, path: string): Promise<Trace> {
  try {
    return await load()
  } catch (error) {
    process.stderr.write(`Could not load ${path}: ${messageOf(error)}\n${FIX}\n`)
    process.exit(1)
  }
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
  if (parsed.command === 'mcp') {
    installPlainFilter({ stderrOnly: true, homeDir: homeDir() })
  } else {
    installPlainFilter({ homeDir: homeDir() })
  }

  if (parsed.pick && !process.stdin.isTTY) {
    process.stderr.write('--pick needs an interactive terminal\n')
    process.exit(1)
  }

  let readyTraceId: string | undefined
  let readyHook: (() => void) | undefined
  let openOnReady = false
  const handle = createCac(devframe, {
    async onReady({ origin }) {
      readyHook?.()
      const base = `${origin.replace(/\/$/, '')}${BASE_PATH}`
      sayReady(readyTraceId ? `${base}#/s/${readyTraceId}` : `${base}#/`)
      if (openOnReady && readyTraceId) {
        await openBrowser(base, readyTraceId, !parsed.userArgs.includes('--no-auth'))
      }
    },
  })

  if (wantsUsage(parsed.userArgs)) {
    await handle.parse(programArgv(parsed.userArgs))
    return
  }

  if (parsed.command === 'mcp' || parsed.command === 'build') {
    // `build` and `mcp` always redact; only the local server honors `AGENT_TRACE_REDACT=0`.
    const target = sessionTargetOf(parsed.path ?? process.env.AGENT_TRACE_PATH ?? demoFixturePath())
    const sessionPath = sessionTargetLabel(target)
    const current: ResolvedSession = { key: sessionPath, target }
    const load = sessionLoader(target, createNodePlatform())
    const traces = createTraceStore({ redacts: true })
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
          report = await reportOf(traces.store, CURRENT_TRACE_ID, async ids => ids.map(id => byId.get(id)!))
          const included = report.truncated ? `; original records for the first ${report.events.length}` : ''
          return `redacted ${report.total} events${included}`
        },
        write: async () => {
          await writeReport(outDir, report!)
          return outDir
        },
      })
    } catch (error) {
      sayError(`Could not build ${sessionPath}: ${messageOf(error)}`, FIX)
      process.exit(1)
    }
    return
  }

  if (parsed.command === 'export-atif' || parsed.command === 'export-otlp') {
    const format: ExportFormat = parsed.command === 'export-atif' ? 'atif' : 'otlp'
    const target = sessionTargetOf(parsed.path ?? process.env.AGENT_TRACE_PATH ?? demoFixturePath())
    const sessionPath = sessionTargetLabel(target)
    try {
      const trace = await loadSession(target, { platform: createNodePlatform() })
      const written = await writeExport(trace, format, parsed.outFile)
      process.stdout.write(`Wrote ${written}\n`)
    } catch (error) {
      sayError(`Could not export ${sessionPath}: ${messageOf(error)}`, FIX)
      process.exit(1)
    }
    return
  }

  sayStart(pkg.version)
  const redacts = process.env.AGENT_TRACE_REDACT !== '0'
  const platform = createNodePlatform()
  const catalog = new SessionCatalog({ platform, noIndex: parsed.noIndex, deferSummaries: true })
  const traces = createTraceStore({ platform, redacts, resolve: traceId => catalog.resolve(traceId) })
  bindTraceStore(traces.store)
  bindSessionService({ listSessions: input => catalog.listSessions(input) })
  bindReportExporter(input => exportReport(traces.store, input))
  readyHook = () => catalog.resumeSummaries()
  if (catalog.indexUnavailable) {
    sayWarning(`Session index unavailable: ${catalog.indexUnavailable}; running without it`)
  }

  const direct = parsed.pick ? undefined : (parsed.path ?? process.env.AGENT_TRACE_PATH)
  if (direct) {
    const target = sessionTargetOf(direct)
    const trace = await loadLaunch(platform, target, `Could not load ${direct}`)
    readyTraceId = catalog.openPath(target, trace)
    await traces.seed({ key: readyTraceId, target }, trace)
  }

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
  } catch (error) {
    indexing.cancel()
    sayError(
      `Could not index sessions: ${messageOf(error)}`,
      'Check the agent session directories, or pass --no-index.',
    )
    process.exit(1)
  }

  if (parsed.pick) {
    await catalog.discovered()
    const options = catalog.pickChoices()
    if (options.length === 0) {
      sayError('No sessions to pick.', FIX)
      process.exit(1)
    }
    readyTraceId = await pickSession(options)
    const picked = catalog.resolve(readyTraceId)!
    const trace = await loadLaunch(platform, picked.target, 'Could not load the picked session')
    await traces.seed(picked, trace)
  }

  // DevFrame opens `/__agent-trace/` and puts its one-time code in the fragment, so it
  // cannot open `#/s/<traceId>` itself. With a session, the shell opens the browser instead.
  const userArgs = parsed.userArgs.filter(arg => arg !== '--open')
  if (readyTraceId && !userArgs.includes('--no-open')) {
    openOnReady = true
    userArgs.push('--no-open')
  }
  await handle.parse(programArgv(userArgs))
}
