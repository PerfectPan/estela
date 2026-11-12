import type { SessionAdapter } from '@rivus/agent-kit/sessions'
import type { Transcript } from '@rivus/agent-kit/transcript'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { err, ok } from '@rivus/agent-kit/catalog'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openSessionIndex } from '@rivus/estela-runtime-node'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { SessionCatalog } from './session-catalog.ts'

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
})
