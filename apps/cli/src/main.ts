import { resolve } from 'node:path'
import process from 'node:process'
import { splitSessionRef } from '@rivus/agent-trace-kernel'
import { bindSessionService } from '@rivus/agent-trace-rpc'
import { createBuild } from 'devframe/adapters/build'
import { createCac } from 'devframe/adapters/cac'
import pkg from '../package.json' with { type: 'json' }
import { parseCommand, programArgv, wantsUsage } from './argv.ts'
import devframe, { BASE_PATH } from './devframe.ts'
import { demoFixturePath } from './paths.ts'
import { listSessionChoices, Session } from './session.ts'
import { installPlainFilter, pickSession, sayBuild, sayError, sayReady, sayStart, startLoad } from './terminal.ts'

const FIX = 'Pass a canonical agent-trace/v0 JSON file, or a session path a registered host accepts.'

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
    installPlainFilter({ stderrOnly: true })
  else
    installPlainFilter()

  if (parsed.pick && !process.stdin.isTTY) {
    process.stderr.write('--pick needs an interactive terminal\n')
    process.exit(1)
  }

  const handle = createCac(devframe, {
    onReady({ origin }) {
      const url = `${origin.replace(/\/$/, '')}${BASE_PATH}`
      sayReady(url)
    },
  })

  if (wantsUsage(parsed.userArgs)) {
    await handle.parse(programArgv(parsed.userArgs))
    return
  }

  let sessionPath = normalizeSessionPath(parsed.path ?? process.env.AGENT_TRACE_PATH ?? demoFixturePath())
  if (parsed.pick)
    sessionPath = normalizeSessionPath(await pickSession(listSessionChoices(sessionPath)))

  const session = new Session(sessionPath, parsed.command !== 'dev')
  bindSessionService(session)

  if (parsed.command === 'mcp') {
    await loadOrExit(session, { mcp: true })
    await handle.parse(programArgv(parsed.userArgs))
    return
  }

  if (parsed.command === 'build') {
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
  const loading = startLoad()
  const trace = await loadOrExit(session, { cancel: () => loading.cancel() })
  loading.stop(trace.events.length)
  const userArgs = [...parsed.userArgs]
  if (parsed.pick && !userArgs.includes('--open') && !userArgs.includes('--no-open'))
    userArgs.push('--open')
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
