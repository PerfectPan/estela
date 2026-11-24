import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { disposeAll, namesNeitherHome, readText, rowsOf, session, start, tempDir } from './support/estela-server.ts'

afterEach(disposeAll)

describe('one redaction source', () => {
  it('redacts list rows and picker labels as the server’s `redacts` says, whatever ESTELA_REDACT says', async () => {
    const home = await tempDir('redaction')
    await session(home)
    const raw = await start(home, { redacts: false })
    const { read } = await rowsOf(raw.server)
    expect(read.title).toContain(home)
    expect(
      raw.server
        .catalog!.pickChoices()
        .map(choice => choice.label)
        .join('\n'),
    ).toContain(home)

    for (const env of [{}, { ESTELA_REDACT: '0' }]) {
      const redacted = await start(home, { platform: createNodePlatform({ home, env }) })
      const listed = await redacted.server.catalog!.listSessions()
      expect(listed.rows.find(row => !row.error)!.title).not.toBe(read.title)
      namesNeitherHome(JSON.stringify(listed), home)
      namesNeitherHome(
        redacted.server
          .catalog!.pickChoices()
          .map(choice => choice.label)
          .join('\n'),
        home,
      )
    }
  })

  it('hides both homes from what always redacts, with `redacts: false` and a platform home of its own', async () => {
    const home = await tempDir('redaction')
    await session(home)
    const { server, ctx } = await start(home, { redacts: false })
    const { read, elsewhere, refused } = await rowsOf(server)
    expect(read.title).toContain(home)
    // A working directory under either home, a read error, and the roots that were checked name paths.
    expect(read.cwd).toBe(join('~', 'work', 'secret'))
    expect(elsewhere.cwd).toBe(join('~', 'work', 'elsewhere'))
    namesNeitherHome(elsewhere.cwd!, home)
    expect(refused.error?.file).toBe(join('~', '.claude', 'projects', 'bad', 'session.jsonl'))
    namesNeitherHome(JSON.stringify({ cwd: read.cwd, error: refused.error }), home)
    namesNeitherHome(JSON.stringify((await server.catalog!.listSessions()).agents), home)
    // The MCP tools redact whatever the server's `redacts` says.
    const event = String(await ctx.agent.invoke('estela:get_event', { traceId: read.traceId, eventId: 'a-redaction' }))
    expect(event).toContain(readText())
    namesNeitherHome(event, home)
    namesNeitherHome(String(await ctx.agent.invoke('estela:session_summary', { traceId: read.traceId })), home)
  })

  it('hides both homes from the trace with `redacts: true`', async () => {
    const home = await tempDir('redaction')
    await session(home)
    const { server } = await start(home)
    const { read } = await rowsOf(server)
    await server.open(read.traceId)
    const view = JSON.stringify(await server.store.view(read.traceId))
    expect(view).toContain(readText())
    namesNeitherHome(view, home)
    namesNeitherHome(JSON.stringify(await server.store.event(read.traceId, 'a-redaction')), home)
  })

  it('keeps the index’s own failure reason redacted', async () => {
    const home = await tempDir('redaction')
    // A file where the cache directory should be fails the index on every system; chmod cannot make a
    // directory read-only on Windows.
    const cache = join(home, 'cache')
    await writeFile(cache, '')
    const { server } = await start(home, {
      catalog: { index: true },
      platform: createNodePlatform({ home, env: { XDG_CACHE_HOME: cache } }),
    })
    namesNeitherHome(server.catalog!.indexUnavailable!, home)
    expect(server.catalog!.indexUnavailable).toContain('~')
  })
})
