import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { openSessionIndex } from '../src/session-index.ts'

it('keeps summaries, search rows, and removal independent for sessions sharing a database', async () => {
  const home = await mkdtemp(join(tmpdir(), 'shared-index-'))
  const file = join(home, 'index.sqlite')
  const head = { agent: 'opencode', path: join(home, 'opencode.db'), size: 10, mtimeMs: 1 }
  let index = openSessionIndex({ file, summaryVersion: 1 })
  try {
    index.putSummaries([
      { ...head, traceId: 'a', sessionId: 'a', title: 'Alpha', summary: { requests: 1 }, prompts: ['first'] },
      { ...head, traceId: 'b', sessionId: 'b', title: 'Beta', summary: { requests: 2 }, prompts: ['second'] },
    ])
    index.close()
    index = openSessionIndex({ file, summaryVersion: 1 })
    expect(index.rows()).toHaveLength(2)
    expect(index.get('a', 10, 1)).toEqual({ requests: 1 })
    expect(index.get('b', 10, 1)).toEqual({ requests: 2 })
    expect(index.search('first')).toEqual(['a'])
    expect(index.search('second')).toEqual(['b'])
    index.remove(['a'])
    expect(index.rows().map(row => row.traceId)).toEqual(['b'])
    expect(index.search('first')).toEqual([])
    expect(index.search('second')).toEqual(['b'])
  } finally {
    index.close()
    await rm(home, { recursive: true, force: true })
  }
})
