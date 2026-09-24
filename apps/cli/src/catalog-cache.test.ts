import type { HostAdapter } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSessionIndex } from '@rivus/agent-trace-runtime-node'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionCatalog } from './catalog.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-cache-'))
  dirs.push(dir)
  return dir
}

const source = { file: 'fixture', offset: 0, length: 1, line: 1 }

/** One session per `*.jsonl` file under `<home>/sessions`; the file text is the title and the prompt. */
function fakeHost(home: string, loads: string[]): HostAdapter {
  const root = join(home, 'sessions')
  return {
    id: 'fake',
    displayName: 'Fake',
    capabilities: ['requests'],
    roots: () => [root],
    async *discover(dir, _io, opts) {
      const names = (await readdir(dir)).filter(name => name.endsWith('.jsonl')).toSorted()
      opts.onTotal?.(names.length)
      for (const name of names) {
        const path = join(dir, name)
        if (name.startsWith('bad')) {
          yield { ref: { host: 'fake', path }, error: `fake: ${path}:4: unknown format generation` }
          continue
        }
        const title = await readFile(path, 'utf8')
        yield { ref: { host: 'fake', path }, title, firstPrompt: title, lastActiveAt: (await stat(path)).mtimeMs, sizeBytes: 1 }
      }
    },
    async detect() {
      return false
    },
    async load(ref): Promise<Trace> {
      loads.push(ref.path)
      return {
        schema: 'agent-trace',
        host: { id: 'fake' },
        session: { id: ref.path },
        capabilities: ['requests'],
        agents: [{ id: 'main' }],
        events: [
          { id: 'u', seq: 0, ts: 1, kind: 'user', payload: { text: 'hello' }, source },
          { id: 'r', seq: 1, ts: 2, kind: 'request', payload: {}, source },
        ],
        skipped: [],
      }
    },
  }
}

async function session(home: string, name: string, text: string): Promise<string> {
  await mkdir(join(home, 'sessions'), { recursive: true })
  const path = join(home, 'sessions', name)
  await writeFile(path, text)
  return path
}

describe('session catalog cache', () => {
  it('sends an empty delta after discover on an unchanged home, and re-reads a changed file', async () => {
    const home = await tempHome()
    await session(home, 'a.jsonl', 'Alpha')
    const changed = await session(home, 'b.jsonl', 'Beta')
    // A fractional mtime, as APFS and ext4 report.
    await utimes(changed, 1_758_000_000.123_456, 1_758_000_000.123_456)
    const file = join(home, 'index.sqlite')
    const env = { homeDir: home, env: {} }
    const loads: string[] = []
    const first = new SessionCatalog({ env, hosts: [fakeHost(home, loads)], index: openSessionIndex({ file }) })
    await first.whenIdle()
    first.close()
    expect(loads).toHaveLength(2)

    const second = new SessionCatalog({ env, hosts: [fakeHost(home, loads)], index: openSessionIndex({ file }) })
    const cached = await second.listSessions()
    await second.discovered()
    const delta = await second.listSessions({ since: cached.revision })
    expect(delta.rows).toEqual([])
    expect(delta.removed).toBeUndefined()
    second.close()

    await writeFile(changed, 'Beta, edited')
    const third = new SessionCatalog({ env, hosts: [fakeHost(home, loads)], index: openSessionIndex({ file }), deferSummaries: true })
    const before = await third.listSessions()
    await third.discovered()
    const after = await third.listSessions({ since: before.revision })
    expect(after.rows.map(row => [row.title, row.pending])).toEqual([['Beta, edited', true]])
    third.close()
  })

  it('re-summarizes a row cached under an older SUMMARY_VERSION', async () => {
    const home = await tempHome()
    const path = await session(home, 'a.jsonl', 'Alpha')
    const file = join(home, 'index.sqlite')
    const env = { homeDir: home, env: {} }
    const loads: string[] = []
    const old = new SessionCatalog({ env, hosts: [fakeHost(home, loads)], index: openSessionIndex({ file, summaryVersion: 0 }) })
    await old.whenIdle()
    old.close()
    const current = new SessionCatalog({ env, hosts: [fakeHost(home, loads)], index: openSessionIndex({ file }) })
    const listed = await current.listSessions()
    expect(listed.rows[0]?.pending).toBe(true)
    await current.whenIdle()
    expect((await current.listSessions()).rows[0]?.requests).toBe(1)
    expect(loads).toEqual([path, path])
    current.close()
  })

  it('redacts titles and prompts in the list and the picker unless AGENT_TRACE_REDACT=0', async () => {
    const home = await tempHome()
    await session(home, 'a.jsonl', `Read ${join('HOME', 'notes')} with sk-abcdefghijklmnop\nthen stop`.replace('HOME', home))
    const hosts = [fakeHost(home, [])]
    const redacted = new SessionCatalog({ env: { homeDir: home, env: {} }, hosts, noIndex: true, deferSummaries: true })
    const row = (await redacted.listSessions()).rows[0]!
    expect(row.title).toBe('Read ~/notes with [redacted]\nthen stop')
    expect(row.firstPrompt).toBe(row.title)
    expect(JSON.stringify(await redacted.listSessions())).not.toContain(home)
    expect(redacted.pickChoices()[0]?.label).toMatch(/^Read ~\/notes with \[redacted\] then stop · Fake · /)
    const raw = new SessionCatalog({ env: { homeDir: home, env: { AGENT_TRACE_REDACT: '0' } }, hosts, noIndex: true, deferSummaries: true })
    expect((await raw.listSessions()).rows[0]?.title).toContain(home)
  })

  it('places an unreadable file at its mtime, not at 1970', async () => {
    const home = await tempHome()
    const bad = await session(home, 'bad.jsonl', 'x')
    const catalog = new SessionCatalog({ env: { homeDir: home, env: {} }, hosts: [fakeHost(home, [])], noIndex: true })
    const row = (await catalog.listSessions()).rows[0]!
    expect(row.error?.line).toBe(4)
    expect(row.lastActiveAt).toBe((await stat(bad)).mtimeMs)
  })

  it('runs without the index when the cache directory is not writable', async () => {
    const home = await tempHome()
    await session(home, 'a.jsonl', 'Alpha')
    const cache = join(home, 'cache')
    await mkdir(cache)
    await chmod(cache, 0o500)
    try {
      const catalog = new SessionCatalog({ env: { homeDir: home, env: { XDG_CACHE_HOME: cache } }, hosts: [fakeHost(home, [])] })
      expect(catalog.indexUnavailable).toMatch(/EACCES|permission/i)
      await catalog.whenIdle()
      const listed = await catalog.listSessions({ query: 'Alp' })
      expect(listed.rows[0]?.requests).toBe(1)
      expect(listed.matches).toHaveLength(1)
    }
    finally {
      await chmod(cache, 0o700)
    }
  })
})
