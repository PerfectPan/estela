import process from 'node:process'
import { createBuild } from 'devframe/adapters/build'
import { createCac } from 'devframe/adapters/cac'
import pkg from '../package.json' with { type: 'json' }
import { parseCommand, programArgv } from './argv.ts'
import devframe, { BASE_PATH } from './devframe.ts'
import { demoFixturePath } from './paths.ts'
import { listSessionChoices, Session } from './session.ts'
import { installPlainFilter, isPlainOutput, pickSession, sayBuild, sayError, sayReady, sayStart, startLoad } from './terminal.ts'

const FIX = 'Pass a canonical agent-trace/v0 JSON file, or a session path a registered host accepts.'

export async function main(): Promise<void> {
  installPlainFilter()
  const parsed = parseCommand(process.argv)
  if (parsed.pick && (!process.stdin.isTTY || isPlainOutput())) {
    process.stderr.write('--pick needs an interactive terminal\n')
    process.exit(1)
  }

  const handle = createCac(devframe, {
    onReady({ origin }) {
      const url = `${origin.replace(/\/$/, '')}${BASE_PATH}`
      return sayReady(url)
    },
  })

  if (parsed.help || parsed.version) {
    await handle.parse(programArgv(parsed.userArgs))
    return
  }

  let sessionPath = parsed.path ?? process.env.AGENT_TRACE_PATH ?? demoFixturePath()
  if (parsed.pick)
    sessionPath = await pickSession(listSessionChoices(sessionPath))

  const mode = parsed.command === 'build' ? 'build' : parsed.command === 'mcp' ? 'mcp' : 'server'
  const session = new Session(sessionPath, mode)
  session.bind()

  if (parsed.command === 'mcp') {
    await loadOrExit(session)
    await handle.parse(programArgv(parsed.userArgs))
    return
  }

  if (parsed.command === 'build') {
    const outDir = parsed.outDir ?? 'dist-static'
    try {
      await sayBuild({
        load: async () => {
          const trace = await session.load()
          return `${trace.events.length} events`
        },
        redact: async () => {
          await session.currentTrace()
          return 'redacted'
        },
        write: async () => {
          await createBuild(devframe, { outDir })
          return outDir
        },
      })
    }
    catch (error) {
      await sayError(`Could not build ${session.path}: ${messageOf(error)}`, FIX)
      process.exit(1)
    }
    return
  }

  await sayStart(pkg.version)
  const loading = await startLoad()
  const trace = await loadOrExit(session, () => loading.cancel())
  loading.stop(trace.events.length)
  const userArgs = [...parsed.userArgs]
  if (parsed.pick && !userArgs.includes('--open') && !userArgs.includes('--no-open'))
    userArgs.push('--open')
  await handle.parse(programArgv(userArgs))
}

async function loadOrExit(session: Session, cancel?: () => void) {
  try {
    return await session.load()
  }
  catch (error) {
    cancel?.()
    await sayError(`Could not load ${session.path}: ${messageOf(error)}`, FIX)
    process.exit(1)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
