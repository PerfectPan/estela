import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import type { ExportReportInput, ExportReportResult, SessionListRow } from '@rivus/estela-rpc'
import type { DevframeNodeContext } from 'devframe'
import { NAMESPACE } from '@rivus/estela-rpc'
import { createHostContext } from 'devframe/node'
import { expect, vi } from 'vite-plus/test'
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
  vi.useRealTimers()
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

/** `text` as JSON writes it into a serialized output: on Windows every `\` of a path becomes `\\`. */
export function inJson(text: string): string {
  return JSON.stringify(text).slice(1, -1)
}

/** Neither the platform home nor the process home is in `text`, written plainly or as JSON escapes it. */
export function namesNeitherHome(text: string, home: string): void {
  for (const dir of [home, processHome]) {
    expect(text).not.toContain(dir)
    expect(text).not.toContain(inJson(dir))
  }
}

/**
 * A path as the server returns it outside the platform home: absolute, with the process home it is under shown
 * as `~`. A Windows runner's temporary directory is in the process home, so a path a test made can be one.
 */
export function shown(path: string): string {
  return path.replace(processHome, '~')
}

/** What the assistant event of `session` says once both homes are hidden. */
export function readText(): string {
  return `I read ${tilde('work', 'secret', 'notes.md')} and ${tilde('.ssh', 'id_rsa')}`
}

/**
 * A Claude Code session whose prompt names both homes and whose recorded text names the platform home and,
 * in the full text, the process home; beside one that ran under the process home with a token in its short
 * prompt, and one the reader refuses. The kit cuts a title to 80 characters before anything redacts it, so
 * only the short prompt's title keeps its token whole.
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
  // A session that ran under the process home, so its working directory names that home, with a token in its prompt.
  await mkdir(join(projects, 'elsewhere'))
  await writeFile(
    join(projects, 'elsewhere/session.jsonl'),
    `${JSON.stringify({
      ...records[0],
      sessionId: 's-elsewhere',
      cwd: join(processHome, 'work/elsewhere'),
      message: { role: 'user', content: 'Read notes with sk-abcdefghijklmnop\nthen stop' },
    })}\n`,
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
 * The rows of a started server: the session whose text names both homes, the one that ran under the process
 * home, and the one the reader refuses.
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

/**
 * Calls "Export report" as the browser's RPC does: through the `export-report` handler registered on
 * `ctx`. DevFrame's build logs as it writes; the test output stays without them.
 */
export async function exportBound(ctx: DevframeNodeContext, input: ExportReportInput): Promise<ExportReportResult> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    return await ctx.rpc.invokeLocal(`${NAMESPACE}:export-report`, input)
  } finally {
    log.mockRestore()
  }
}
