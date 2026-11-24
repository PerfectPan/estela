import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import type { ExportReportInput, ExportReportResult, SessionListRow } from '@rivus/estela-rpc'
import { serverFunctions } from '@rivus/estela-rpc'
import { createHostContext } from 'devframe/node'
import { expect, vi } from 'vite-plus/test'
import * as z from 'zod/mini'
import { createEstelaServer, type EstelaServer, type EstelaServerOptions } from '../../src/index.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

/**
 * The home of the user the test process runs as. The server under test reads another home, so an output
 * can name either: the platform's, through what the agent recorded, or this one, through what the server
 * produces or what a tool of the agent's printed.
 */
const processHome = homedir()

/** A web build in the shape a report needs: one module script and one stylesheet. */
const reportSite = join(repo, 'packages/server/test/fixtures/report-site')

const dirs: string[] = []
const servers: EstelaServer[] = []

/** Closes every server and removes every directory a test made. Call it from `afterEach`. */
export async function disposeAll(): Promise<void> {
  vi.restoreAllMocks()
  for (const server of servers.splice(0)) {
    server.close()
  }
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
}

export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
  dirs.push(dir)
  return dir
}

/** `~` and the parts, with this system's separator after the home directory. */
function tilde(...parts: string[]): string {
  return join('~', ...parts)
}

/** Neither the platform home nor the process home is in `text`. */
export function namesNeitherHome(text: string, home: string): void {
  expect(text).not.toContain(home)
  expect(text).not.toContain(processHome)
}

/** What the assistant event of `session` says once both homes are hidden. */
export function readText(): string {
  return `I read ${tilde('work', 'secret', 'notes.md')} and ${tilde('.ssh', 'id_rsa')}`
}

/**
 * A Claude Code session whose prompt names the platform home and, in the full text, the process home, beside
 * one the reader refuses and one that ran under the process home. The kit cuts a title before anything
 * redacts it, so the platform home comes first and whole.
 */
export async function session(home: string): Promise<void> {
  const projects = join(home, '.claude/projects')
  await mkdir(join(projects, 'app'), { recursive: true })
  await mkdir(join(projects, 'bad'))
  await cp(
    join(repo, 'fixtures/sessions/claude-code/unknown-generation/session.jsonl'),
    join(projects, 'bad/session.jsonl'),
  )
  const base = { sessionId: 's-redaction', version: '2.0.0', cwd: join(home, 'work/secret') }
  const records = [
    {
      ...base,
      type: 'user',
      uuid: 'u-redaction',
      timestamp: '2026-02-01T00:00:00.000Z',
      message: { role: 'user', content: `Read ${join(home, 'w')} and ${join(processHome, 's')}` },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'a-redaction',
      requestId: 'req-redaction',
      timestamp: '2026-02-01T00:00:01.000Z',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5-20250929',
        id: 'msg-redaction',
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 3 },
        content: [
          {
            type: 'text',
            text: `I read ${join(home, 'work/secret/notes.md')} and ${join(processHome, '.ssh/id_rsa')}`,
          },
        ],
      },
    },
  ]
  await writeFile(join(projects, 'app/session.jsonl'), records.map(record => `${JSON.stringify(record)}\n`).join(''))
  // A session that ran under the process home: its working directory names that home.
  await mkdir(join(projects, 'elsewhere'))
  await writeFile(
    join(projects, 'elsewhere/session.jsonl'),
    `${JSON.stringify({ ...records[0], sessionId: 's-elsewhere', cwd: join(processHome, 'work/elsewhere') })}\n`,
  )
}

/** A server over `home`, set up as DevFrame runs it, so that its services are bound. */
export async function start(home: string, pick: Partial<EstelaServerOptions> = {}) {
  const server = createEstelaServer({
    app: {
      packageName: '@rivus/estela',
      version: '0.0.0-test',
      homepage: 'https://example.invalid',
      description: 'test',
      clientAssets: reportSite,
    },
    platform: createNodePlatform({ home, env: {} }),
    catalog: { index: false },
    launch: undefined,
    redacts: true,
    ...pick,
  })
  servers.push(server)
  const ctx = await createHostContext({
    cwd: home,
    mode: 'dev',
    host: {
      mountStatic: () => {},
      resolveOrigin: () => 'http://localhost',
      getStorageDir: () => join(home, '.devframe'),
    },
    importMetaUrl: import.meta.url,
  })
  await server.definition.setup(ctx, { flags: {} })
  await server.catalog!.whenIdle()
  return { server, ctx }
}

/**
 * The rows of a started server: the session `session` wrote, the one that ran under the process home, and
 * the one the reader refuses.
 */
export async function rowsOf(server: EstelaServer): Promise<{
  read: SessionListRow
  elsewhere: SessionListRow
  refused: SessionListRow
}> {
  const rows = (await server.catalog!.listSessions()).rows
  // Both sessions start with the same prompt; the one under `app` alone holds a request.
  const read = rows.filter(row => !row.error)
  return {
    read: read.find(row => row.requests)!,
    elsewhere: read.find(row => !row.requests)!,
    refused: rows.find(row => row.error)!,
  }
}

const rpcSetup = z.function({
  input: [z.unknown()],
  output: z.promise(z.object({ handler: z.function({ input: [z.unknown()], output: z.promise(z.unknown()) }) })),
})
const exportResult = z.object({
  path: z.string(),
  included: z.number(),
  total: z.number(),
})

/**
 * Calls "Export report" as the browser's RPC does: through the `export-report` handler, which reaches the
 * exporter the server bound. DevFrame's build logs as it writes; the test output stays without them.
 */
export async function exportBound(input: ExportReportInput): Promise<ExportReportResult> {
  const definition = serverFunctions.find(candidate => candidate.name === 'export-report')
  if (!definition) {
    throw new Error('the RPC package no longer registers export-report')
  }
  const setup = z.parse(rpcSetup, definition.setup)
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const { handler } = await setup({ rpc: { getCurrentRpcSession: () => ({ meta: {} }) } })
    return z.parse(exportResult, await handler(input))
  } finally {
    log.mockRestore()
  }
}
