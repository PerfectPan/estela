import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { DevframeNodeContext } from 'devframe'
import * as z from 'zod/mini'
import { disposeAll, exportBound, namesNeitherHome, start, tempDir } from './support/estela-server.ts'

afterEach(disposeAll)

/** Two keys under the home that redact to the same text, and one that redacts to no other key's text. */
const keys = (home: string): Record<string, number> => ({
  [join(home, 'sk-aaaaaaaaaaaaaaaa/x.ts')]: 1,
  [join(home, 'sk-bbbbbbbbbbbbbbbb/x.ts')]: 2,
  [join(home, 'y.ts')]: 3,
})
/** The same keys, redacted: the later one of two that meet keeps its value under `#2`. */
const shownKeys: Record<string, number> = { '~/[redacted]/x.ts': 1, '~/[redacted]/x.ts#2': 2, '~/y.ts': 3 }

/** Two directories under the home that redact to the same text. */
const tokenDirs = { one: 'sk-cccccccccccccccc', two: 'sk-dddddddddddddddd' } as const

/**
 * Three Claude Code sessions: one whose event id names the home and whose tool call holds `keys`, and one in each
 * directory of `tokenDirs`. Their records are written at run time, since no literal home path sits in the repository.
 */
async function keyedSessions(home: string): Promise<void> {
  const projects = join(home, '.claude/projects')
  const base = { sessionId: 's-ids', version: '2.0.0', cwd: join(home, 'work/ids') }
  const line = (record: unknown): string => `${JSON.stringify(record)}\n`
  await mkdir(join(projects, 'ids'), { recursive: true })
  await writeFile(
    join(projects, 'ids/session.jsonl'),
    line({
      ...base,
      type: 'assistant',
      uuid: join(home, 'ids/call'),
      requestId: 'req-ids',
      timestamp: '2026-02-01T00:00:01.000Z',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5-20250929',
        id: 'msg-ids',
        stop_reason: 'tool_use',
        usage: { input_tokens: 7, output_tokens: 3 },
        content: [{ type: 'tool_use', id: 'call-ids', name: 'Read', input: keys(home) }],
      },
    }),
  )
  for (const [name, dir] of Object.entries(tokenDirs)) {
    await mkdir(join(projects, name), { recursive: true })
    await writeFile(
      join(projects, `${name}/session.jsonl`),
      line({
        ...base,
        sessionId: `s-${name}`,
        cwd: join(home, 'work', dir),
        type: 'user',
        uuid: `u-${name}`,
        timestamp: '2026-02-01T00:00:00.000Z',
        message: { role: 'user', content: `hi ${name}` },
      }),
    )
  }
}

const numbers = z.record(z.string(), z.number())
const detail = z.object({ id: z.string(), payload: z.object({ args: z.unknown() }), original: z.optional(z.unknown()) })
const record = z.object({ message: z.object({ content: z.array(z.object({ input: z.unknown() })) }) })
/** The tool call's input as its log record holds it. */
function recordInput(original: unknown): Record<string, number> {
  return z.parse(numbers, z.parse(record, original).message.content[0]!.input)
}
const tooled = z.object({
  event: z.object({ id: z.string(), payload: z.object({ args: z.unknown() }), original: z.optional(z.unknown()) }),
})
const page = z.object({
  sessions: z.array(z.object({ traceId: z.string(), title: z.optional(z.string()), cwd: z.optional(z.string()) })),
})

/** `get-event` as the browser's RPC calls it. DevFrame logs that no request is bound; the test output stays clean. */
async function getEventBound(ctx: DevframeNodeContext, input: { traceId: string; id: string }): Promise<unknown> {
  const logs = (['log', 'warn', 'error'] as const).map(name => vi.spyOn(console, name).mockImplementation(() => {}))
  try {
    return await ctx.rpc.invokeLocal('estela:get-event', input)
  } finally {
    for (const log of logs) {
      log.mockRestore()
    }
  }
}

/** One agent tool's result, which arrives as JSON text. */
async function tool(ctx: DevframeNodeContext, name: string, args: unknown): Promise<unknown> {
  return JSON.parse(z.parse(z.string(), await ctx.agent.invoke(`estela:${name}`, args)))
}

describe('redaction keeps what is looked up by', () => {
  it('reads an event whose recorded id names the home, as the view shows it, and exports the session', async () => {
    const home = await tempDir('redacted-keys')
    await keyedSessions(home)
    const { ctx, server } = await start(home)
    const row = (await server.catalog!.listSessions()).rows.find(one => one.cwd === join('~', 'work', 'ids'))!
    const view = await server.store.view(row.traceId)
    const call = view.trace.events.find(event => event.kind === 'tool_call')!
    // The id is an alias: the home it names is not shown, and no other id could meet it after redaction.
    expect(call.id).toMatch(/^@e\d+$/)
    namesNeitherHome(JSON.stringify(view), home)

    // Through the RPC the browser calls, with the id the view gave it.
    const event = z.parse(detail, await getEventBound(ctx, { traceId: row.traceId, id: call.id }))
    expect(event.id).toBe(call.id)
    expect(z.parse(numbers, event.payload.args)).toEqual(shownKeys)
    expect(recordInput(event.original)).toEqual(shownKeys)
    namesNeitherHome(JSON.stringify(event), home)

    // "Export report" reads the originals through the view's ids.
    const dir = await tempDir('redacted-keys-cwd')
    vi.spyOn(process, 'cwd').mockReturnValue(dir)
    const exported = await exportBound(ctx, { traceId: row.traceId, locale: 'en' })
    const [report] = await readdir(dir)
    const html = await readFile(join(dir, report!, 'index.html'), 'utf8')
    expect(html).toContain(`"id":"${call.id}"`)
    expect(html).toContain('"args":{"~/[redacted]/x.ts":1,"~/[redacted]/x.ts#2":2,"~/y.ts":3}')
    expect(html).toContain('"input":{"~/[redacted]/x.ts":1,"~/[redacted]/x.ts#2":2,"~/y.ts":3}')
    namesNeitherHome(html, home)
    expect(exported).toMatchObject({ included: view.trace.events.length, total: view.trace.events.length })
  })

  it('answers the agent tools with the alias they asked by, and with every value of the keys that met', async () => {
    const home = await tempDir('redacted-keys')
    await keyedSessions(home)
    const { ctx } = await start(home)
    const listed = await tool(ctx, 'list_sessions', {})
    const row = z.parse(page, listed).sessions.find(one => one.cwd === join('~', 'work', 'ids'))!
    const turns = z.parse(
      z.object({ turns: z.array(z.object({ lastEventId: z.string() })) }),
      await tool(ctx, 'list_turns', { traceId: row.traceId }),
    )
    const alias = turns.turns[0]!.lastEventId
    expect(alias).toMatch(/^@e\d+$/)
    // `estela mcp` and the dev server redact what the store sends; the tools show those ids once more.
    const got = z.parse(tooled, await tool(ctx, 'get_event', { traceId: row.traceId, eventId: alias, original: true }))
    expect(got.event.id).toBe(alias)
    expect(z.parse(numbers, got.event.payload.args)).toEqual(shownKeys)
    expect(recordInput(got.event.original)).toEqual(shownKeys)
    namesNeitherHome(JSON.stringify(got), home)
  })

  it('filters the agent tools by the working directory as recorded, which two directories redact to the same text', async () => {
    const home = await tempDir('redacted-keys')
    await keyedSessions(home)
    const { ctx } = await start(home)
    const titles = async (cwd: string): Promise<(string | undefined)[]> =>
      z.parse(page, await tool(ctx, 'list_sessions', { cwd })).sessions.map(one => one.title)
    const [one, two] = [join(home, 'work', tokenDirs.one), join(home, 'work', tokenDirs.two)]
    // What the rows show cannot tell the two directories apart.
    expect(z.parse(page, await tool(ctx, 'list_sessions', {})).sessions.map(one => one.cwd)).toEqual([
      join('~', 'work', 'ids'),
      join('~', 'work', '[redacted]'),
      join('~', 'work', '[redacted]'),
    ])
    expect(await titles(one)).toEqual(['hi one'])
    expect(await titles(two)).toEqual(['hi two'])
    expect(await titles(join('~', 'work', tokenDirs.two))).toEqual(['hi two'])
    expect(await titles(`${one}/`)).toEqual(['hi one'])
    // A directory that holds both still lists each.
    const both = await titles(join(home, 'work'))
    expect(both).toHaveLength(3)
    expect(both).toEqual(expect.arrayContaining(['hi one', 'hi two']))
    const found = await tool(ctx, 'search_sessions', { query: 'hi', cwd: join('~', 'work', tokenDirs.two) })
    expect(z.parse(page, found).sessions.map(one => one.title)).toEqual(['hi two'])
  })
})
