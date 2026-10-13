import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { openSessionIndex, type IndexSummary } from './session-index.ts'

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

describe('session index rows that do not parse', () => {
  it('treats stored values of the wrong type as missing data', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putSummaries([
      summary({ ref: 'a', path: '/logs/a.jsonl', summary: { turns: 2, contextShape: [1, 2] } }),
      summary({ ref: 'b', path: '/logs/b.jsonl', summary: { turns: 3, contextShape: [3] } }),
    ])
    const raw = new DatabaseSync(file)
    // A damaged shape loses only the shape; a non-number count loses the cached summary.
    raw.exec(`UPDATE sessions SET context_shape = '[1, "x"]' WHERE ref = 'a'`)
    raw.exec(`UPDATE sessions SET turns = 'many' WHERE ref = 'b'`)
    expect(index.get('/logs/a.jsonl', 10, 1_000)).toEqual({ turns: 2 })
    expect(index.get('/logs/b.jsonl', 10, 1_000)).toBeUndefined()
    raw.exec(`UPDATE sessions SET context_shape = 'not json' WHERE ref = 'a'`)
    expect(index.get('/logs/a.jsonl', 10, 1_000)).toEqual({ turns: 2 })
    raw.close()
    index.close()
  })

  it('drops a row whose head does not parse, with its prompts and search row, until discover writes it again', async () => {
    const file = join(await tempDir(), 'index.sqlite')
    const index = openSessionIndex({ summaryVersion: 1, file })
    index.putSummaries([
      summary({ ref: 'a', path: '/logs/a.jsonl', title: 'Alpha', prompts: ['find the needle'] }),
      summary({ ref: 'b', path: '/logs/b.jsonl', title: 'Beta', prompts: ['other'] }),
      summary({ ref: 'c', path: '/logs/c.jsonl', title: 'Gamma', prompts: ['stale haystack'] }),
    ])
    const raw = new DatabaseSync(file)
    raw.exec(`UPDATE sessions SET size = 'big' WHERE ref = 'a'`)
    const left = (ref: string) => raw.prepare('SELECT count(*) AS n FROM prompts WHERE ref = ?').get(ref)?.n
    expect(index.rows().map(row => row.ref)).toEqual(['b', 'c'])
    expect(raw.prepare('SELECT ref FROM sessions ORDER BY ref').all()).toEqual([{ ref: 'b' }, { ref: 'c' }])
    expect(left('a')).toBe(0)
    expect(index.search('needle')).toEqual([])
    expect(index.search('ph')).toEqual([])
    index.putHeads([
      { ref: 'a', agent: 'claude-code', path: '/logs/a.jsonl', size: 10, mtimeMs: 1_000, title: 'Alpha' },
    ])
    expect(index.search('Alpha')).toEqual(['a'])
    expect(index.get('/logs/a.jsonl', 10, 1_000)).toBeUndefined()
    // A write that finds an unparsable row, before any `rows` call, drops the old ref's prompts too.
    raw.exec(`UPDATE sessions SET size = 'big' WHERE ref = 'c'`)
    expect(left('c')).toBe(1)
    index.putHeads([{ ref: 'c2', agent: 'claude-code', path: '/logs/c.jsonl', size: 10, mtimeMs: 1_000 }])
    expect(left('c')).toBe(0)
    expect(index.search('haystack')).toEqual([])
    expect(
      index
        .rows()
        .map(row => row.ref)
        .toSorted(),
    ).toEqual(['a', 'b', 'c2'])
    raw.close()
    index.close()
  })
})
