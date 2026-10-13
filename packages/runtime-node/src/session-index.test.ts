import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { sqliteErrcode } from './session-index-schema.ts'
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
    agent: 'claude-code',
    size: 10,
    mtimeMs: 1_000,
    title: 'Fix the auth refresh',
    summary: { turns: 2, requests: 4, inputTokens: 118_400, outputTokens: 0 },
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
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    expect(index.get('/logs/a.jsonl', 10, 1_000)?.turns).toBe(2)
    expect(index.get('/logs/a.jsonl', 10, 1_000)?.outputTokens).toBe(0)
    expect(index.get('/logs/a.jsonl', 10, 1_000)?.inputTokens).toBe(118_400)
    expect(index.get('/logs/a.jsonl', 11, 1_000)).toBeUndefined()
    index.close()
    expect(statSync(file).mode & 0o777).toBe(0o600)

    const again = openSessionIndex({ summaryVersion: 1, file })
    expect(again.get('/logs/a.jsonl', 10, 1_000)?.requests).toBe(4)
    expect(again.get('/logs/a.jsonl', 10, 2_000)).toBeUndefined()
    again.close()
  })

  it('does not treat a head write as a cached summary', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putHeads([
      {
        ref: 'a',
        agent: 'codex',
        path: '/logs/a.jsonl',
        size: 10,
        mtimeMs: 1_000,
        title: 'Fix the auth refresh',
        firstPrompt: 'Run the tests please',
      },
    ])
    expect(index.get('/logs/a.jsonl', 10, 1_000)).toBeUndefined()
    expect(index.search('Run the tests')).toEqual(['a'])
    index.close()
  })

  it('rebuilds when user_version does not match', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl', title: 'Fix the auth refresh' })])
    index.close()
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA user_version = 9')
    raw.close()
    const rebuilt = openSessionIndex({ summaryVersion: 1, file })
    expect(rebuilt.get('/logs/a.jsonl', 10, 1_000)).toBeUndefined()
    expect(rebuilt.search('Fix')).toEqual([])
    rebuilt.putSummaries([summary({ ref: 'b', path: '/logs/b.jsonl', title: 'Other' })])
    expect(rebuilt.search('Ot')).toEqual(['b'])
    rebuilt.close()
  })

  it('rebuilds an index written with the previous layout instead of reading it', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    index.close()
    // The previous layout: the same tables with the agent column named `host`, at user_version 1.
    const raw = new DatabaseSync(file)
    raw.exec('ALTER TABLE sessions RENAME COLUMN agent TO host; PRAGMA user_version = 1')
    raw.close()
    const rebuilt = openSessionIndex({ summaryVersion: 1, file })
    expect(rebuilt.enabled).toBe(true)
    expect(rebuilt.rows()).toEqual([])
    rebuilt.putSummaries([summary({ ref: 'b', path: '/logs/b.jsonl' })])
    expect(rebuilt.rows().map(row => [row.ref, row.agent])).toEqual([['b', 'claude-code']])
    rebuilt.close()
  })

  it('rebuilds a file that is not a database', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    writeFileSync(file, 'not a database')
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    expect(index.search('auth')).toEqual(['a'])
    expect(statSync(file).mode & 0o777).toBe(0o600)
    index.close()
  })

  it('searches English and Chinese prompts, and matches short queries as substrings', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ summaryVersion: 1, file })
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
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putSummaries([
      summary({
        ref: 'a',
        path: '/logs/a.jsonl',
        summary: { turns: 0, failedTools: 0 },
      }),
    ])
    const cached = index.get('/logs/a.jsonl', 10, 1_000)
    expect(cached?.turns).toBe(0)
    expect(cached?.failedTools).toBe(0)
    expect(cached?.requests).toBeUndefined()
    expect(cached?.inputTokens).toBeUndefined()
    index.close()
  })

  it('does not create a file when the index is disabled', async () => {
    const file = join(await tempDir(), 'missing', 'index.sqlite')
    const index = openSessionIndex({ summaryVersion: 1, file, enabled: false })
    index.putHeads([{ ref: 'a', agent: 'grok', path: '/logs/a.jsonl', size: 1, mtimeMs: 1 }])
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    expect(index.get('/logs/a.jsonl', 10, 1_000)).toBeUndefined()
    expect(index.search('auth')).toBeUndefined()
    expect(index.enabled).toBe(false)
    expect(() => statSync(file)).toThrow(/ENOENT/)
    index.close()
  })

  it('matches a short query as a substring of titles and prompts', async () => {
    const index = openSessionIndex({ summaryVersion: 1, file: join(await tempDir(), 'index.sqlite') })
    index.putSummaries([
      summary({ ref: 'zh', path: '/logs/zh.jsonl', title: '修复登录', prompts: ['请帮我看看这个测试为什么失败'] }),
      summary({ ref: 'en', path: '/logs/en.jsonl', title: 'Fix the auth refresh', prompts: ['Run the tests please'] }),
    ])
    expect(index.search('登录')).toEqual(['zh'])
    expect(index.search('测试')).toEqual(['zh'])
    expect(index.search('au')).toEqual(['en'])
    expect(index.search('%')).toEqual([])
    index.close()
  })

  it('treats control characters and FTS operators as plain text', async () => {
    const index = openSessionIndex({ summaryVersion: 1, file: join(await tempDir(), 'index.sqlite') })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl', title: 'Fix the auth refresh' })])
    expect(index.search('auth\u0000 refresh')).toEqual([])
    expect(index.search('\u0000\u0007')).toBeUndefined()
    expect(index.search('auth" OR "x')).toEqual([])
    expect(index.search('NEAR(auth')).toEqual([])
    expect(index.search('auth refresh')).toEqual(['a'])
    index.close()
  })

  it('does not return a summary written under another summary version', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const old = openSessionIndex({ file, summaryVersion: 0 })
    old.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    expect(old.get('/logs/a.jsonl', 10, 1_000)?.turns).toBe(2)
    old.close()
    const current = openSessionIndex({ summaryVersion: 1, file })
    expect(current.get('/logs/a.jsonl', 10, 1_000)).toBeUndefined()
    expect(current.rows()[0]?.summary).toBeUndefined()
    expect(current.rows()[0]?.title).toBe('Fix the auth refresh')
    current.close()
  })

  it('reads NULL head columns as absent fields', async () => {
    const index = openSessionIndex({ summaryVersion: 1, file: join(await tempDir(), 'index.sqlite') })
    index.putHeads([{ ref: 'a', agent: 'grok', path: '/logs/a.jsonl', size: 1, mtimeMs: 2 }])
    expect(index.rows()).toEqual([{ ref: 'a', agent: 'grok', path: '/logs/a.jsonl', size: 1, mtimeMs: 2 }])
    index.close()
  })

  it('treats stored values of the wrong type as missing data', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putSummaries([
      summary({ ref: 'a', path: '/logs/a.jsonl', summary: { turns: 2, contextShape: [1, 2] } }),
      summary({ ref: 'b', path: '/logs/b.jsonl', summary: { turns: 3, contextShape: [3] } }),
    ])
    const raw = new DatabaseSync(file)
    // A damaged shape loses only the shape; a non-number count loses the cached summary; a bad head hides the row.
    raw.exec(`UPDATE sessions SET context_shape = '[1, "x"]' WHERE ref = 'a'`)
    raw.exec(`UPDATE sessions SET turns = 'many' WHERE ref = 'b'`)
    expect(index.get('/logs/a.jsonl', 10, 1_000)).toEqual({ turns: 2 })
    expect(index.get('/logs/b.jsonl', 10, 1_000)).toBeUndefined()
    raw.exec(`UPDATE sessions SET context_shape = 'not json' WHERE ref = 'a'`)
    expect(index.get('/logs/a.jsonl', 10, 1_000)).toEqual({ turns: 2 })
    raw.exec(`UPDATE sessions SET size = 'big' WHERE ref = 'a'`)
    raw.close()
    expect(index.rows().map(row => row.ref)).toEqual(['b'])
    index.putHeads([{ ref: 'a', agent: 'claude-code', path: '/logs/a.jsonl', size: 10, mtimeMs: 1_000 }])
    expect(
      index
        .rows()
        .map(row => row.ref)
        .toSorted(),
    ).toEqual(['a', 'b'])
    index.close()
  })

  it('reads the SQLite result code off a node:sqlite error', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const holder = new DatabaseSync(file)
    holder.exec('CREATE TABLE t (x); BEGIN IMMEDIATE')
    const other = new DatabaseSync(file, { timeout: 0 })
    let busy: unknown
    try {
      other.exec('BEGIN IMMEDIATE')
    } catch (error) {
      busy = error
    }
    expect(sqliteErrcode(busy)).toBe(5)
    expect(sqliteErrcode(new Error('not from SQLite'))).toBeUndefined()
    expect(sqliteErrcode(undefined)).toBeUndefined()
    other.close()
    holder.exec('ROLLBACK')
    holder.close()
  })

  it('keeps a fractional mtime exact', async () => {
    const index = openSessionIndex({ summaryVersion: 1, file: join(await tempDir(), 'index.sqlite') })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl', mtimeMs: 1_758_000_000_123.456 })])
    expect(index.get('/logs/a.jsonl', 10, 1_758_000_000_123.456)?.turns).toBe(2)
    expect(index.rows()[0]?.mtimeMs).toBe(1_758_000_000_123.456)
    index.close()
  })

  it('creates the directory 0700 and the file 0600', async () => {
    const file = join(await tempDir(), 'cache', 'rivus-agent-trace', 'index.sqlite')
    openSessionIndex({ summaryVersion: 1, file }).close()
    expect(statSync(dirname(file)).mode & 0o777).toBe(0o700)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('returns a disabled index with the reason when the cache directory is not writable', async () => {
    const cache = join(await tempDir(), 'cache')
    mkdirSync(cache)
    chmodSync(cache, 0o500)
    try {
      const index = openSessionIndex({ summaryVersion: 1, env: { XDG_CACHE_HOME: cache }, homeDir: '/h/u' })
      expect(index.enabled).toBe(false)
      expect(index.unavailable).toMatch(/EACCES|permission/i)
      expect(index.search('x')).toBeUndefined()
      index.close()
    } finally {
      chmodSync(cache, 0o700)
    }
  })

  it('lets several processes open a fresh cache at once', async () => {
    const dir = await tempDir()
    const file = join(dir, 'index.sqlite')
    const module = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'session-index.ts')).href
    const child = join(dir, 'child.mjs')
    writeFileSync(
      child,
      `
      const { openSessionIndex } = await import(${JSON.stringify(module)})
      const n = process.argv[2]
      const index = openSessionIndex({ summaryVersion: 1, file: ${JSON.stringify(file)} })
      if (!index.enabled) { console.error(index.unavailable); process.exit(2) }
      index.putSummaries([{ ref: 'r' + n, agent: 'h', path: '/logs/' + n, size: 1, mtimeMs: 1, summary: { turns: 1 }, prompts: [] }])
      index.close()
    `,
    )
    const runs = Array.from(
      { length: 6 },
      (_, n) =>
        new Promise<{ code: number | null; stderr: string }>(resolve => {
          const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', child, String(n)], {
            stdio: ['ignore', 'ignore', 'pipe'],
          })
          let stderr = ''
          proc.stderr.on('data', (chunk: Buffer) => {
            stderr += String(chunk)
          })
          proc.on('close', code => resolve({ code, stderr }))
        }),
    )
    const results = await Promise.all(runs)
    expect(results).toEqual(Array.from({ length: 6 }, () => ({ code: 0, stderr: '' })))
    const index = openSessionIndex({ summaryVersion: 1, file })
    expect(
      index
        .rows()
        .map(row => row.ref)
        .toSorted(),
    ).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5'])
    index.close()
  })

  it('folds non-ASCII case the same way on both sides', async () => {
    const index = openSessionIndex({ summaryVersion: 1, file: join(await tempDir(), 'index.sqlite') })
    index.putSummaries([
      summary({ ref: 'de', path: '/logs/de.jsonl', title: 'Über die Tests', prompts: [] }),
      summary({ ref: 'ru', path: '/logs/ru.jsonl', title: 'Добро пожаловать', prompts: [] }),
    ])
    expect(index.search('über')).toEqual(['de'])
    expect(index.search('ÜB')).toEqual(['de'])
    expect(index.search('добро')).toEqual(['ru'])
    expect(index.search('ДО')).toEqual(['ru'])
    index.close()
  })

  it('uses WAL, and gives the -wal and -shm files and an existing directory the private modes', async () => {
    const dir = join(await tempDir(), 'rivus-agent-trace')
    mkdirSync(dir, { mode: 0o755 })
    chmodSync(dir, 0o755)
    const file = join(dir, 'index.sqlite')
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    for (const suffix of ['', '-wal', '-shm']) {
      expect({ suffix, mode: statSync(`${file}${suffix}`).mode & 0o777 }).toEqual({ suffix, mode: 0o600 })
    }
    const raw = new DatabaseSync(file)
    expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    raw.close()
    index.close()
  })

  it('answers searches at once while another process holds BEGIN EXCLUSIVE', async () => {
    const dir = await tempDir()
    const file = join(dir, 'index.sqlite')
    const seed = openSessionIndex({ summaryVersion: 1, file })
    seed.putSummaries([summary({ ref: 'a', path: '/logs/a.jsonl' })])
    seed.close()
    const holder = spawn(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '-e',
        `
      const { DatabaseSync } = require('node:sqlite')
      const db = new DatabaseSync(${JSON.stringify(file)})
      db.exec('BEGIN EXCLUSIVE')
      db.exec("UPDATE sessions SET title = 'held' WHERE ref = 'a'")
      process.stdout.write('locked\\n')
      setTimeout(() => { db.exec('ROLLBACK'); db.close() }, 3000)
    `,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    await new Promise<void>(resolve => holder.stdout.once('data', () => resolve()))
    const started = performance.now()
    const index = openSessionIndex({ summaryVersion: 1, file })
    expect(index.enabled).toBe(true)
    expect(index.search('auth')).toEqual(['a'])
    expect(index.rows()).toHaveLength(1)
    expect(index.get('/logs/a.jsonl', 10, 1_000)?.turns).toBe(2)
    expect(() => index.putSummaries([summary({ ref: 'b', path: '/logs/b.jsonl' })])).toThrow(/locked/)
    expect(performance.now() - started).toBeLessThan(1_000)
    index.close()
    holder.kill()
  })

  it('rebuilds a broken file once when several processes open it at the same time', async () => {
    const dir = await tempDir()
    const file = join(dir, 'index.sqlite')
    writeFileSync(file, 'not a database, not at all')
    const module = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'session-index.ts')).href
    const child = join(dir, 'child.mjs')
    writeFileSync(
      child,
      `
      const { openSessionIndex } = await import(${JSON.stringify(module)})
      const n = process.argv[2]
      const index = openSessionIndex({ summaryVersion: 1, file: ${JSON.stringify(file)} })
      if (!index.enabled) { console.error(index.unavailable); process.exit(2) }
      index.putSummaries([{ ref: 'r' + n, agent: 'h', path: '/logs/' + n, size: 1, mtimeMs: 1, summary: { turns: 1 }, prompts: [] }])
      index.close()
    `,
    )
    const results = await Promise.all(
      Array.from(
        { length: 4 },
        (_, n) =>
          new Promise<string>(resolve => {
            const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', child, String(n)], {
              stdio: ['ignore', 'ignore', 'pipe'],
            })
            let stderr = ''
            proc.stderr.setEncoding('utf8')
            proc.stderr.on('data', (chunk: string) => {
              stderr += chunk
            })
            // The exit code and, on failure, why: `index.unavailable` or a stack.
            proc.on('close', code => resolve(code === 0 ? '0' : `${code}: ${stderr.trim()}`))
          }),
      ),
    )
    expect(results).toEqual(['0', '0', '0', '0'])
    const index = openSessionIndex({ summaryVersion: 1, file })
    expect(
      index
        .rows()
        .map(row => row.ref)
        .toSorted(),
    ).toEqual(['r0', 'r1', 'r2', 'r3'])
    index.close()
  })
})
