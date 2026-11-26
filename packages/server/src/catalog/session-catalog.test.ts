import type { SessionAdapter } from '@rivus/agent-kit/sessions'
import type { Transcript } from '@rivus/agent-kit/transcript'
import type { SessionsSignal } from '@rivus/estela-rpc'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { err, ok } from '@rivus/agent-kit/catalog'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { openSessionIndex } from '@rivus/estela-runtime-node'
import type { ShellPlatform } from '../sessions/load-session.ts'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { SessionCatalog, type AgentProgress } from './session-catalog.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'catalog-home-'))
  dirs.push(dir)
  return dir
}

const source = { file: 'fixture', offset: 0, length: 1, line: 1 }

function transcript(path: string, text: string): Transcript {
  return {
    agent: 'fake',
    session: { id: path },
    capabilities: ['requests', 'usage'],
    agents: [{ id: 'main' }],
    events: [
      { id: 'u', seq: 0, ts: 1, kind: 'user', payload: { text }, source },
      { id: 'r', seq: 1, ts: 2, kind: 'request', payload: { usage: { inputTokens: 12, outputTokens: 3 } }, source },
    ],
    skipped: [],
  }
}

describe('session catalog', () => {
  it('shows a missing root as count 0 and an unreadable file with its line', async () => {
    const home = await tempHome()
    const claude = join(repo, 'fixtures/sessions/claude-code/conformance')
    const grok = join(repo, 'fixtures/sessions/grok/conformance/plain')
    await mkdir(join(home, '.claude/projects/plain'), { recursive: true })
    await mkdir(join(home, '.claude/projects/bad'), { recursive: true })
    await cp(join(claude, 'plain/session.jsonl'), join(home, '.claude/projects/plain/session.jsonl'))
    await cp(
      join(repo, 'fixtures/sessions/claude-code/unknown-generation/session.jsonl'),
      join(home, '.claude/projects/bad/session.jsonl'),
    )
    await cp(join(claude, 'subagent'), join(home, '.claude/projects/sub'), { recursive: true })
    await cp(grok, join(home, '.grok/sessions/plain'), { recursive: true })
    const badPath = join(home, '.claude/projects/bad/session.jsonl')
    const index = openSessionIndex({ summaryVersion: 1, file: join(home, 'index.sqlite') })
    const catalog = new SessionCatalog({ platform: createNodePlatform({ home, env: {} }), index })
    const first = await catalog.listSessions()
    const codex = first.agents.find(agent => agent.id === 'codex')
    expect(codex?.count).toBe(0)
    // The kit's Codex roots also cover archived sessions (design note §3.2 X7).
    expect(codex?.checked).toBe('~/.codex/sessions, ~/.codex/archived_sessions')
    expect(first.rows.filter(row => row.agent === 'claude-code')).toHaveLength(3)
    expect(first.agents.find(agent => agent.id === 'claude-code')?.count).toBe(3)
    // Trace ids are opaque and the list carries no absolute path.
    expect(JSON.stringify(first)).not.toContain(home)
    expect(first.rows.every(row => /^[0-9a-f]{24}$/.test(row.traceId))).toBe(true)

    await catalog.whenIdle()
    const done = await catalog.listSessions()
    const broken = done.rows.find(row => row.error)
    expect(broken?.error?.line).toBe(1)
    expect(broken?.error?.reason).toContain('unknown format generation')
    expect(broken?.pending).toBe(false)
    const info = await stat(badPath)
    expect(index.get(broken!.traceId, info.size, info.mtimeMs)).toBeUndefined()
    const plain = done.rows.find(row => row.firstPrompt === 'Run the tests')
    expect(plain?.pending).toBe(false)
    expect(plain?.requests).toBeGreaterThan(0)
    expect(plain?.cwd?.startsWith('~/') || plain?.cwd === '/work/app' || plain?.project).toBeTruthy()

    const second = new SessionCatalog({ platform: createNodePlatform({ home, env: {} }), index })
    const cached = await second.listSessions()
    const cachedPlain = cached.rows.find(row => row.firstPrompt === 'Run the tests')
    expect(cachedPlain?.pending).toBe(false)
    expect(cachedPlain?.requests).toBe(plain?.requests)
    index.close()
  })

  // chmod cannot make a directory unreadable on Windows, nor for a user (root) the mode bits do not stop.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0).each([
    // The root's parent has no search permission: the `stat` of the root fails.
    { locked: '.claude', syscall: 'stat' },
    // The root itself has no read permission: the kit's `discover` fails for the root.
    { locked: '.claude/projects', syscall: 'scandir' },
  ])('lists the other agents when $locked cannot be read, and says that root', async ({ locked, syscall }) => {
    const home = await tempHome()
    const root = join(home, '.claude/projects')
    await mkdir(root, { recursive: true })
    await cp(join(repo, 'fixtures/sessions/grok/conformance/plain'), join(home, '.grok/sessions/plain'), {
      recursive: true,
    })
    const index = openSessionIndex({ summaryVersion: 1, file: join(home, 'index.sqlite') })
    const lockedDir = join(home, locked)
    await chmod(lockedDir, 0o000)
    try {
      const catalog = new SessionCatalog({ platform: createNodePlatform({ home, env: {} }), index })
      let progress: readonly AgentProgress[] = []
      await catalog.start(agents => {
        progress = agents
      })
      const listed = await catalog.listSessions()
      expect(listed.rows.filter(row => row.agent === 'grok')).toHaveLength(1)
      const reason = `EACCES: permission denied, ${syscall} '~/.claude/projects'`
      expect(listed.rows.filter(row => row.agent === 'claude-code')).toMatchObject([
        { pending: false, error: { reason, file: '~/.claude/projects' } },
      ])
      expect(catalog.unreadableRoots).toEqual([
        { agent: 'claude-code', displayName: 'Claude Code', path: '~/.claude/projects', reason, code: 'EACCES' },
      ])
      expect(JSON.stringify([listed, catalog.unreadableRoots])).not.toContain(home)
      // The per-agent progress line names the root too.
      expect(progress.find(agent => agent.name === 'Claude Code')).toMatchObject({
        done: true,
        unreadable: '~/.claude/projects',
      })
      catalog.close()
    } finally {
      await chmod(lockedDir, 0o700)
    }
  })

  it('still fails the start for a failure outside reading the agent roots', async () => {
    const home = await tempHome()
    const root = join(home, 'sessions')
    await mkdir(root)
    const file = join(root, '1.jsonl')
    await writeFile(file, 'x')
    const adapter: SessionAdapter = {
      specificationVersion: 'sessions-v1',
      agent: 'fake',
      displayName: 'Fake',
      home: { defaultPath: [] },
      capabilities: ['requests'],
      roots: () => [root],
      // The head is yielded without a stat, so the catalog's own stat of the file is the first one.
      async *discover() {
        yield { ref: { agent: 'fake', path: file }, lastActiveAt: 1_000, sizeBytes: 1 }
      },
      async detect() {
        return false
      },
      async load() {
        return ok(transcript(file, 'prompt'))
      },
    }
    const real = createNodePlatform({ home, env: {} })
    // The root reads; the `stat` of the session file, made for its cache key, fails.
    const failing: ShellPlatform = {
      ...real,
      fs: {
        ...real.fs,
        stat: (path, options) => {
          if (path === file) {
            throw Object.assign(new Error("EIO: i/o error, stat '1.jsonl'"), { code: 'EIO' })
          }
          return real.fs.stat(path, options)
        },
      },
    }
    const catalog = new SessionCatalog({ adapters: { fake: adapter }, platform: failing, noIndex: true })
    await expect(catalog.start()).rejects.toThrow("EIO: i/o error, stat '1.jsonl'")
    catalog.close()
  })

  it('redacts titles and prompts by default, or with the caller’s rule when one is passed', async () => {
    const home = await tempHome()
    await mkdir(join(home, '.claude/projects/plain'), { recursive: true })
    await cp(
      join(repo, 'fixtures/sessions/claude-code/conformance/plain/session.jsonl'),
      join(home, '.claude/projects/plain/session.jsonl'),
    )
    const index = openSessionIndex({ summaryVersion: 1, file: join(home, 'index.sqlite') })
    const catalog = new SessionCatalog({ platform: createNodePlatform({ home, env: {} }), index })
    const own = await catalog.listSessions()
    expect(own.rows[0]).toMatchObject({ title: 'Run the tests', firstPrompt: 'Run the tests' })
    const theirs = await catalog.listSessions({}, text => `[${text.length}]`)
    expect(theirs.rows[0]).toMatchObject({ title: '[13]', firstPrompt: '[13]', project: '[3]' })
    catalog.close()
  })

  it('summarizes the newest sessions first, four at a time', async () => {
    const home = await tempHome()
    const root = join(home, 'sessions')
    await mkdir(root)
    const files: string[] = []
    for (let n = 1; n <= 6; n++) {
      const path = join(root, `${n}.jsonl`)
      await writeFile(path, 'x')
      files.push(path)
    }
    let active = 0
    let max = 0
    const started: number[] = []
    const adapter: SessionAdapter = {
      specificationVersion: 'sessions-v1',
      agent: 'fake',
      displayName: 'Fake',
      // The fake ignores `home`; the rule only satisfies `sessionAdapterHome`.
      home: { defaultPath: [] },
      capabilities: ['requests'],
      roots: () => [root],
      async *discover() {
        for (let n = 1; n <= 6; n++) {
          yield {
            ref: { agent: 'fake', path: files[n - 1]! },
            title: n === 6 ? '修复登录' : `Session ${n}`,
            lastActiveAt: n * 1_000,
            sizeBytes: 1,
            firstPrompt: n === 6 ? '请帮我看看这个测试为什么失败' : `prompt ${n}`,
          }
        }
      },
      async detect() {
        return false
      },
      async load(_platform, ref) {
        active += 1
        max = Math.max(max, active)
        const n = Number(ref.path.match(/(\d+)\.jsonl$/)?.[1])
        started.push(n)
        await new Promise(resolve => setTimeout(resolve, 30))
        active -= 1
        const text = n === 6 ? '请帮我看看这个测试为什么失败' : `prompt ${n}`
        return ok(transcript(ref.path, text))
      },
    }
    const catalog = new SessionCatalog({
      adapters: { fake: adapter },
      platform: createNodePlatform({ home, env: {} }),
      noIndex: true,
    })
    await catalog.listSessions()
    await catalog.whenIdle()
    // --no-index: nothing is written to the cache directory.
    expect(existsSync(join(home, '.cache/rivus-estela/index.sqlite'))).toBe(false)
    expect(max).toBeLessThanOrEqual(4)
    expect(started.slice(0, 4).toSorted((a, b) => b - a)).toEqual([6, 5, 4, 3])
    const all = await catalog.listSessions()
    const titleOf = (traceId: string) => all.rows.find(row => row.traceId === traceId)?.title
    const found = await catalog.listSessions({ query: '为什么失败' })
    expect(found.matches?.map(titleOf)).toEqual(['修复登录'])
    const prefix = await catalog.listSessions({ query: '修复' })
    expect(prefix.matches).toHaveLength(1)
    const since = await catalog.listSessions({ since: all.revision })
    expect(since.rows).toEqual([])
    expect(since.complete).toBe(false)
  })

  it('does not cache a summary that fails, and keeps the head', async () => {
    const home = await tempHome()
    const root = join(home, 'sessions')
    await mkdir(root)
    const path = join(root, 'bad.jsonl')
    await writeFile(path, 'x')
    const index = openSessionIndex({ summaryVersion: 1, file: join(home, 'index.sqlite') })
    const adapter: SessionAdapter = {
      specificationVersion: 'sessions-v1',
      agent: 'fake',
      displayName: 'Fake',
      // The fake ignores `home`; the rule only satisfies `sessionAdapterHome`.
      home: { defaultPath: [] },
      capabilities: [],
      roots: () => [root],
      async *discover() {
        yield {
          ref: { agent: 'fake', path },
          title: 'Broken',
          lastActiveAt: 5_000,
          sizeBytes: 1,
        }
      },
      async detect() {
        return false
      },
      async load(_platform, ref) {
        return err({ _tag: 'UnknownFormatGeneration', agent: 'fake', file: ref.path, line: 3 })
      },
    }
    const catalog = new SessionCatalog({
      adapters: { fake: adapter },
      platform: createNodePlatform({ home, env: {} }),
      index,
    })
    await catalog.listSessions()
    await catalog.whenIdle()
    const listed = await catalog.listSessions()
    expect(listed.rows[0]?.title).toBe('Broken')
    expect(listed.rows[0]?.error?.line).toBe(3)
    expect(listed.rows[0]?.requests).toBeUndefined()
    const info = await stat(path)
    expect(index.get(listed.rows[0]!.traceId, info.size, info.mtimeMs)).toBeUndefined()
    index.close()
  })

  it('serves the index rows at once on a second launch, then applies the discover pass', async () => {
    const home = await tempHome()
    const claude = join(repo, 'fixtures/sessions/claude-code/conformance')
    await mkdir(join(home, '.claude/projects/a'), { recursive: true })
    await mkdir(join(home, '.claude/projects/b'), { recursive: true })
    await cp(join(claude, 'plain/session.jsonl'), join(home, '.claude/projects/a/session.jsonl'))
    await cp(join(claude, 'compaction/session.jsonl'), join(home, '.claude/projects/b/session.jsonl'))
    const file = join(home, 'index.sqlite')
    const first = new SessionCatalog({
      platform: createNodePlatform({ home, env: {} }),
      index: openSessionIndex({ summaryVersion: 1, file }),
    })
    await first.whenIdle()
    const firstList = await first.listSessions()
    expect(first.startedFromIndex).toBe(false)
    expect(firstList.rows.every(row => !row.pending)).toBe(true)
    first.close()

    await rm(join(home, '.claude/projects/b'), { recursive: true })
    const second = new SessionCatalog({
      platform: createNodePlatform({ home, env: {} }),
      index: openSessionIndex({ summaryVersion: 1, file }),
    })
    const cached = await second.listSessions()
    expect(second.startedFromIndex).toBe(true)
    expect(cached.rows).toHaveLength(2)
    expect(cached.rows.every(row => !row.pending && row.requests !== undefined)).toBe(true)
    await second.discovered()
    const delta = await second.listSessions({ since: cached.revision })
    const gone = firstList.rows.find(row => row.title !== 'Run the tests' && row.firstPrompt !== 'Run the tests')
    expect(delta.removed).toEqual([gone?.traceId])
    expect((await second.listSessions()).rows).toHaveLength(1)
    second.close()
  })

  it('announces updates only through its own announce callback', async () => {
    const homeA = await tempHome()
    const homeB = await tempHome()
    const claude = join(repo, 'fixtures/sessions/claude-code/conformance/plain/session.jsonl')
    await mkdir(join(homeA, '.claude/projects/a'), { recursive: true })
    await cp(claude, join(homeA, '.claude/projects/a/session.jsonl'))
    const signalsA: SessionsSignal[] = []
    const signalsB: SessionsSignal[] = []
    const catalogA = new SessionCatalog({
      platform: createNodePlatform({ home: homeA, env: {} }),
      noIndex: true,
      announce: signal => signalsA.push(signal),
    })
    const catalogB = new SessionCatalog({
      platform: createNodePlatform({ home: homeB, env: {} }),
      noIndex: true,
      announce: signal => signalsB.push(signal),
    })
    await catalogA.whenIdle()
    expect(signalsA.length).toBeGreaterThan(0)
    expect(signalsA.at(-1)?.pending).toBe(0)
    expect(signalsB).toEqual([])
    const countA = signalsA.length
    await catalogB.whenIdle()
    expect(signalsA).toHaveLength(countA)
    expect(signalsB.length).toBeGreaterThan(0)
    catalogA.close()
    catalogB.close()
  })
})

describe('the working-directory filter', () => {
  it('compares by the platform the catalog reads for, whatever system it runs on', async () => {
    const home = await tempHome()
    const recorded: Record<string, string> = { windows: 'C:/Work/App', posix: '/work/app' }
    for (const [name, cwd] of Object.entries(recorded)) {
      await mkdir(join(home, '.claude/projects', name), { recursive: true })
      await writeFile(
        join(home, '.claude/projects', name, 'session.jsonl'),
        `${JSON.stringify({
          type: 'user',
          uuid: `u-${name}`,
          timestamp: '2026-02-01T00:00:00.000Z',
          sessionId: `s-${name}`,
          cwd,
          version: '2.0.0',
          message: { role: 'user', content: `hi ${name}` },
        })}\n`,
      )
    }
    // A server that reads a Windows user's sessions: its platform says so, wherever the server itself runs.
    const catalog = new SessionCatalog({
      platform: { ...createNodePlatform({ home, env: {} }), os: 'win32' },
      noIndex: true,
    })
    const titles = async (cwd: string): Promise<(string | undefined)[]> =>
      (await catalog.listSessions({ cwd })).rows.map(row => row.title)
    // Windows paths are compared without case and with either separator.
    expect(await titles('C:\\Work\\App')).toEqual(['hi windows'])
    expect(await titles('c:/work/app')).toEqual(['hi windows'])
    expect(await titles('/work/app')).toEqual(['hi posix'])
    catalog.close()
  })
})
