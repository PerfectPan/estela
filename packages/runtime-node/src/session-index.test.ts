import { statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openSessionIndex, sessionIndexFile, type IndexSummary } from './session-index.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'session-index-'))
  dirs.push(dir)
  return dir
}

function summary(partial: Partial<IndexSummary> & Pick<IndexSummary, 'ref' | 'path'>): IndexSummary {
  return {
    host: 'claude-code',
    size: 10,
    mtimeMs: 1_000,
    title: 'Fix the auth refresh',
    summary: { turns: 2, requests: 4, tokensIn: 118_400, tokensOut: 0 },
    prompts: ['Run the tests please'],
    ...partial,
  }
}

describe('session index', () => {
  it('honors XDG_CACHE_HOME and otherwise uses ~/.cache', () => {
    expect(sessionIndexFile({ XDG_CACHE_HOME: '/xdg' }, '/h/u')).toBe('/xdg/rivus-agent-trace/index.sqlite')
    expect(sessionIndexFile({ XDG_CACHE_HOME: '' }, '/h/u')).toBe('/h/u/.cache/rivus-agent-trace/index.sqlite')
    expect(sessionIndexFile({}, '/h/u')).toBe('/h/u/.cache/rivus-agent-trace/index.sqlite')
  })

  it('creates the file with mode 0600 and reopens the same summary', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ file })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    expect(index.get('/logs/a.jsonl', 10, 1_000)?.turns).toBe(2)
    expect(index.get('/logs/a.jsonl', 10, 1_000)?.tokensOut).toBe(0)
    expect(index.get('/logs/a.jsonl', 10, 1_000)?.tokensIn).toBe(118_400)
    expect(index.get('/logs/a.jsonl', 11, 1_000)).toBeUndefined()
    index.close()
    expect(statSync(file).mode & 0o777).toBe(0o600)

    const again = openSessionIndex({ file })
    expect(again.get('/logs/a.jsonl', 10, 1_000)?.requests).toBe(4)
    expect(again.get('/logs/a.jsonl', 10, 2_000)).toBeUndefined()
    again.close()
  })

  it('does not treat a head write as a cached summary', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ file })
    index.putHeads([{ ref: 'a', host: 'codex', path: '/logs/a.jsonl', size: 10, mtimeMs: 1_000, title: 'Fix the auth refresh', firstPrompt: 'Run the tests please' }])
    expect(index.get('/logs/a.jsonl', 10, 1_000)).toBeUndefined()
    expect(index.search('Run the tests')).toEqual(['a'])
    index.close()
  })

  it('rebuilds when user_version does not match', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ file })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl', title: 'Fix the auth refresh' })])
    index.close()
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA user_version = 9')
    raw.close()
    const rebuilt = openSessionIndex({ file })
    expect(rebuilt.get('/logs/a.jsonl', 10, 1_000)).toBeUndefined()
    expect(rebuilt.search('Fix')).toEqual([])
    rebuilt.putSummaries([summary({ ref: 'b', path: '/logs/b.jsonl', title: 'Other' })])
    expect(rebuilt.search('Ot')).toEqual(['b'])
    rebuilt.close()
  })

  it('rebuilds a file that is not a database', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    writeFileSync(file, 'not a database')
    const index = openSessionIndex({ file })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    expect(index.search('auth')).toEqual(['a'])
    expect(statSync(file).mode & 0o777).toBe(0o600)
    index.close()
  })

  it('searches English and Chinese prompts, and prefixes short title queries', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ file })
    index.putSummaries([
      summary({
        ref: 'en',
        path: '/logs/en.jsonl',
        title: 'Fix the auth refresh',
        prompts: ['Run the tests please', 'Check the login timeout'],
      }),
      summary({
        ref: 'zh',
        path: '/logs/zh.jsonl',
        title: '修复登录',
        prompts: ['请帮我看看这个测试为什么失败'],
        summary: { turns: 1 },
      }),
    ])
    expect(index.search('tests')).toEqual(['en'])
    expect(index.search('login')).toEqual(['en'])
    expect(index.search('为什么失败')).toEqual(['zh'])
    expect(index.search('请帮我')).toContain('zh')
    expect(index.search('修复')).toEqual(['zh'])
    expect(index.search('Fi')).toEqual(['en'])
    expect(index.search('nope')).toEqual([])
    expect(index.search('   ')).toBeUndefined()
    index.close()
  })

  it('keeps an undefined capability out of the cache and keeps a real zero', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ file })
    index.putSummaries([summary({
      ref: 'a',
      path: '/logs/a.jsonl',
      summary: { turns: 0, failedTools: 0 },
    })])
    const cached = index.get('/logs/a.jsonl', 10, 1_000)
    expect(cached?.turns).toBe(0)
    expect(cached?.failedTools).toBe(0)
    expect(cached?.requests).toBeUndefined()
    expect(cached?.tokensIn).toBeUndefined()
    index.close()
  })

  it('does not create a file when the index is disabled', async () => {
    const file = join(await tempDir(), 'missing', 'index.sqlite')
    const index = openSessionIndex({ file, enabled: false })
    index.putHeads([{ ref: 'a', host: 'grok', path: '/logs/a.jsonl', size: 1, mtimeMs: 1 }])
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    expect(index.get('/logs/a.jsonl', 10, 1_000)).toBeUndefined()
    expect(index.search('auth')).toBeUndefined()
    expect(index.enabled).toBe(false)
    expect(() => statSync(file)).toThrow()
    index.close()
  })
})
