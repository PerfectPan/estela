import type { IntentsOf, Literal } from '@bomb.sh/router'
import type { SessionTarget } from '@rivus/agent-kit/transcript'
import { resolve } from 'node:path'
import process from 'node:process'
import { parse, printErrors } from '@bomb.sh/router'
import { homeDir } from '@rivus/estela-runtime-node'
import pkg from '../../package.json' with { type: 'json' }
import { demoFixturePath } from '../paths.ts'
import { parseSessionTarget } from '@rivus/estela-server'
import type { ExportFormat } from '../export/write-export.ts'
import { runBuild, type BuildInput } from './commands/build.ts'
import { runDev, type DevInput } from './commands/dev.ts'
import { runExport, type ExportInput } from './commands/export.ts'
import { runMcp, type McpInput } from './commands/mcp.ts'
import { CliError, failureReport, type CliFailure } from './failure.ts'
import { helpText, versionText } from './help.ts'
import { isLoopbackHost } from './host.ts'
import { cliRoutes, type CliRoutes } from './routes.ts'
import { installPlainFilter, sayError } from './ui/terminal.ts'

type Execute = Extract<IntentsOf<CliRoutes>, { method: 'execute' }>

const routes = cliRoutes(pkg.version)

function usage(detail: string): CliError {
  return new CliError({ kind: 'usage', detail })
}

/** The target of a session given on the command line (`path` or `path#sessionId`), its path made absolute. */
function commandLineTarget(input: string): SessionTarget {
  const target = parseSessionTarget(input)
  return { ...target, path: resolve(target.path) }
}

/** An empty ESTELA_PATH names no session. */
function sessionFromEnv(): string | undefined {
  return process.env.ESTELA_PATH || undefined
}

/**
 * The `--mcp` route's bearer token; unset or empty leaves the dev server to make one per launch. DevFrame matches
 * `Bearer <token>` with no whitespace inside, and a client cannot send other than visible ASCII in a header.
 */
function mcpTokenFromEnv(): string | undefined {
  const token = process.env.ESTELA_MCP_TOKEN || undefined
  if (token !== undefined && !/^[\x21-\x7e]+$/.test(token)) {
    throw usage('ESTELA_MCP_TOKEN must be visible ASCII characters without spaces')
  }
  return token
}

/** Session text leaves the process redacted unless ESTELA_REDACT=0; reports always redact. */
function redactsFromEnv(): boolean {
  return process.env.ESTELA_REDACT !== '0'
}

/** `build` and the exports always read one session: the bundled demo trace when nothing names one. */
function oneSession(session: string | undefined): SessionTarget {
  return commandLineTarget(session ?? sessionFromEnv() ?? demoFixturePath())
}

/** The session argument, or the one token after `--` (a path that starts with `-`). */
function sessionOf(argument: string | undefined, literals: Iterable<Literal>): string | undefined {
  const given = [...(argument === undefined ? [] : [argument]), ...Array.from(literals, literal => literal.text)]
  if (given.length > 1) {
    throw usage(`unexpected: \`${given[1]}\``)
  }
  return given[0]
}

/** The dev server's model when the command line gives it nothing. */
const devDefaults: Readonly<Record<string, unknown>> = (() => {
  const bare = parse(routes, { argv: [] })
  if (!bare.ok || bare.method !== 'execute' || bare.route !== '/') {
    throw new Error('estela: the dev server route must run with no arguments')
  }
  return bare.model
})()

/**
 * The router binds a session or option written before a command name to the dev server, which that
 * command never starts; anything that differs from the dev server's empty model was written there.
 */
function rejectDevInput(intent: Execute): void {
  if (intent.route === '/') {
    return
  }
  const dev: Readonly<Record<string, unknown>> = intent.models['/']
  if (Object.entries(dev).some(([key, value]) => value !== devDefaults[key])) {
    throw usage(`put the session and options after \`${intent.path.join(' ')}\``)
  }
}

/** The command an intent selects, its input checked; a usage failure is thrown before anything runs. */
function commandOf(intent: Execute): () => Promise<void> {
  rejectDevInput(intent)
  const session = sessionOf(intent.model.session, intent.literals)
  switch (intent.route) {
    case '/': {
      const { model } = intent
      const pick = model.pick === true
      if (pick && session !== undefined) {
        throw usage('--pick cannot be used with a session path')
      }
      if (pick && !process.stdin.isTTY) {
        throw usage('--pick needs an interactive terminal')
      }
      const host = model.host ?? 'localhost'
      const auth = model.auth !== false
      if (!auth && !isLoopbackHost(host)) {
        throw usage('--no-auth cannot be used with a non-loopback --host')
      }
      // DevFrame refuses a peer on another address only while the route has no token, so the bind keeps it local.
      if (model.mcp === true && !isLoopbackHost(host)) {
        throw usage('--mcp cannot be used with a non-loopback --host')
      }
      const launch = pick ? undefined : (session ?? sessionFromEnv())
      const input: DevInput = {
        launch: launch === undefined ? undefined : { target: commandLineTarget(launch), label: launch },
        pick,
        port: model.port,
        host,
        open: model.open,
        auth,
        mcp: model.mcp === true ? { token: mcpTokenFromEnv() } : undefined,
        index: model.index !== false,
        redacts: redactsFromEnv(),
      }
      return () => runDev(input, pkg.version)
    }
    case '/build': {
      const input: BuildInput = { target: oneSession(session), outDir: intent.model.outDir ?? 'dist-static' }
      return () => runBuild(input, pkg.version)
    }
    case '/mcp': {
      const named = session ?? sessionFromEnv()
      const input: McpInput = { target: named === undefined ? undefined : commandLineTarget(named) }
      return () => runMcp(input)
    }
    case '/export-atif':
    case '/export-otlp': {
      const format: ExportFormat = intent.route === '/export-atif' ? 'atif' : 'otlp'
      const input: ExportInput = {
        target: oneSession(session),
        format,
        out: intent.model.out,
        redacts: redactsFromEnv(),
      }
      return () => runExport(input)
    }
  }
}

/** Shows a failure and returns its exit code: plain stderr lines for usage and `mcp`, else the terminal's error. */
function report(failure: CliFailure, plain: boolean): number {
  const { message, exitCode } = failureReport(failure)
  if (message && plain) {
    process.stderr.write(`${message.cause}\n${message.fix}\n`)
  } else if (message) {
    sayError(message.cause, message.fix)
  }
  return exitCode
}

/** Parses `argv` once, runs the selected command, and returns the exit code. A dev server keeps running after it returns. */
export async function runCli(argv: readonly string[]): Promise<number> {
  const result = parse(routes, { argv: [...argv] })
  if (!result.ok) {
    return report({ kind: 'usage', detail: printErrors(result) }, true)
  }
  switch (result.method) {
    case 'help':
      process.stdout.write(`${helpText(result)}\n`)
      return 0
    case 'version':
      process.stdout.write(`${versionText(pkg.version)}\n`)
      return 0
    case 'execute':
      break
  }
  let run: () => Promise<void>
  try {
    run = commandOf(result)
  } catch (error) {
    if (error instanceof CliError) {
      return report(error.failure, true)
    }
    throw error
  }
  // `mcp` writes only to stderr: stdout carries the protocol.
  const protocol = result.route === '/mcp'
  installPlainFilter({ stderrOnly: protocol, homeDir: homeDir() })
  try {
    await run()
    return 0
  } catch (error) {
    if (error instanceof CliError) {
      return report(error.failure, protocol)
    }
    throw error
  }
}
