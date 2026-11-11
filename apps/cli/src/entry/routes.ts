import { argument, command, description, name, option, schema, toggle, version } from '@bomb.sh/router'
import * as z from 'zod/mini'

const PORT_RANGE = 'expected a port number from 0 to 65535'
const nonEmpty = z.string().check(z.minLength(1, 'expected a value'))
/** A file or directory to write. `-`, stdout in many CLIs, is refused rather than written as a file named `-`. */
const outputPath = z.string().check(
  z.minLength(1, 'expected a value'),
  z.refine(value => value !== '-', 'expected a path; writing to stdout (-) is not supported'),
)
const port = z.int(PORT_RANGE).check(z.gte(0, PORT_RANGE), z.lte(65535, PORT_RANGE))
/** Absent when the flag is not given, so the default stays with whoever owns it (DevFrame, the catalog). */
const tristate = z.optional(z.boolean())

/**
 * The session a command reads, with the default the help names. Tokens after `--` arrive as the intent's
 * literals; `app.ts` takes them as this argument.
 */
function session(fallback: string) {
  return argument(
    name('session'),
    description(`A session file, path#sessionId, or canonical agent-trace JSON (default: ${fallback})`),
    schema(z.optional(nonEmpty)),
  )
}

const ONE_SESSION = 'AGENT_TRACE_PATH, else the bundled demo trace'

/**
 * Every way into the CLI. `@bomb.sh/router` rejects any token a route does not take, so an unknown
 * option fails before a session is read. Each route carries the version so `--version` works after
 * any command.
 */
export function cliRoutes(packageVersion: string) {
  return command(
    name('agent-trace'),
    description('Inspect coding-agent sessions in the browser: one session, or every session the agents keep.'),
    version(packageVersion),
    session('AGENT_TRACE_PATH'),
    option(
      name('port'),
      description('Port to listen on; 0 picks a free one (default: 7392 or the next free port)'),
      schema(z.optional(port)),
    ),
    option(name('host'), description('Host to bind to (default: localhost)'), schema(z.optional(nonEmpty))),
    toggle(name('open'), description('Open the browser once the server is ready (default: on)'), schema(tristate)),
    toggle(name('auth'), description('Gate the browser with a one-time code (default: on)'), schema(tristate)),
    toggle(
      name('mcp'),
      description('Serve MCP over HTTP from the dev server (default: once agent tools exist)'),
      schema(tristate),
    ),
    toggle(name('pick'), description('Pick a session in the terminal')),
    toggle(name('index'), description('Read and write the session index (default: on)'), schema(tristate)),
    command(
      name('build'),
      description('Write a redacted report of one session as a single index.html'),
      version(packageVersion),
      session(ONE_SESSION),
      option(name('outDir'), description('Output directory (default: dist-static)'), schema(z.optional(outputPath))),
    ),
    command(
      name('mcp'),
      description('Serve MCP tools for one session over stdio'),
      version(packageVersion),
      session(ONE_SESSION),
    ),
    command(
      name('export-atif'),
      description('Write one session as an ATIF v1.8 trajectory'),
      version(packageVersion),
      session(ONE_SESSION),
      option(
        name('out'),
        description('Output file (default: agent-trace-<session>.atif.json)'),
        schema(z.optional(outputPath)),
      ),
    ),
    command(
      name('export-otlp'),
      description('Write one session as an OTLP/JSON trace request'),
      version(packageVersion),
      session(ONE_SESSION),
      option(
        name('out'),
        description('Output file (default: agent-trace-<session>.otlp.json)'),
        schema(z.optional(outputPath)),
      ),
    ),
  )
}

export type CliRoutes = ReturnType<typeof cliRoutes>
