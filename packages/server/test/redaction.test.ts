import { writeFile } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  disposeAll,
  inJson,
  namesNeitherHome,
  readText,
  rowsOf,
  session,
  start,
  tempDir,
} from './support/estela-server.ts'

afterEach(disposeAll)

describe('one redaction source', () => {
  it('redacts list rows and picker labels as the server’s `redacts` says, whatever ESTELA_REDACT says', async () => {
    const home = await tempDir('redaction')
    await session(home)
    const raw = await start(home, { redacts: false })
    const { read, elsewhere } = await rowsOf(raw.server)
    expect(read.title).toContain(home)
    expect(elsewhere.title).toBe('Read notes with sk-abcdefghijklmnop\nthen stop')
    expect(
      raw.server
        .catalog!.pickChoices()
        .map(choice => choice.label)
        .join('\n'),
    ).toContain(home)

    // Whole: each home as `~`, the token as its placeholder, the prompt kept. A title keeps its line break,
    // a picker label is one line.
    const prompt = `Read ${join('~', 'w')} and ${join('~', 's')}`
    const token = 'Read notes with [redacted]\nthen stop'
    for (const env of [{}, { ESTELA_REDACT: '0' }]) {
      const redacted = await start(home, { platform: createNodePlatform({ home, env }) })
      const { read: shown, elsewhere: tokenRow } = await rowsOf(redacted.server)
      expect(shown.firstPrompt).toBe(prompt)
      expect(tokenRow.title).toBe(token)
      expect(tokenRow.firstPrompt).toBe(token)
      const labels = redacted.server.catalog!.pickChoices()
      const label = (traceId: string) => labels.find(choice => choice.value === traceId)?.label ?? ''
      expect(label(tokenRow.traceId).startsWith(`${token.replaceAll('\n', ' ')} · Claude Code · `)).toBe(true)
      namesNeitherHome(JSON.stringify(await redacted.server.catalog!.listSessions()), home)
      namesNeitherHome(labels.map(choice => choice.label).join('\n'), home)
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
    // A working directory is recorded content, so it keeps the system's separators. The file of a read error is
    // the path the kit listed the session under, which has `/` on every system: the kit turns a Windows home's
    // `\` into `/` before it lists.
    expect(refused.error?.file).toBe('~/.claude/projects/bad/session.jsonl')
    namesNeitherHome(JSON.stringify({ cwd: read.cwd, error: refused.error }), home)
    namesNeitherHome(JSON.stringify((await server.catalog!.listSessions()).agents), home)
    // The MCP tools redact whatever the server's `redacts` says.
    // Serialized outputs: a Windows path's separators are escaped in them, so the expected text is escaped too.
    const event = String(await ctx.agent.invoke('estela:get_event', { traceId: read.traceId, eventId: 'a-redaction' }))
    expect(event).toContain(inJson(readText()))
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
    expect(view).toContain(inJson(readText()))
    namesNeitherHome(view, home)
    namesNeitherHome(JSON.stringify(await server.store.event(read.traceId, 'a-redaction')), home)
  })

  // The index's failure reason always redacts: with `redacts: false`, a reason that followed the flag would
  // show the home.
  it.each([false, true])('keeps the index’s own failure reason redacted with `redacts: %s`', async redacts => {
    const home = await tempDir('redaction')
    // A file where the cache directory should be fails the index on every system; chmod cannot make a
    // directory read-only on Windows.
    const cache = join(home, 'cache')
    await writeFile(cache, '')
    const { server } = await start(home, {
      redacts,
      catalog: { index: true },
      platform: createNodePlatform({ home, env: { XDG_CACHE_HOME: cache } }),
    })
    namesNeitherHome(server.catalog!.indexUnavailable!, home)
    expect(server.catalog!.indexUnavailable).toContain('~')
  })

  it('sees a home that JSON has escaped, as a Windows path is in every serialized output', () => {
    const home = win32.join('C:\\Users\\runner', 'platform-home')
    const text = `I read ${win32.join(home, 'notes.md')}`
    const output = JSON.stringify({ text })
    expect(output).toContain(inJson(text))
    expect(output).not.toContain(text)
    expect(() => namesNeitherHome(output, home)).toThrow('not to contain')
    expect(() =>
      namesNeitherHome(JSON.stringify({ text: `I read ${win32.join('~', 'notes.md')}` }), home),
    ).not.toThrow()
  })
})
