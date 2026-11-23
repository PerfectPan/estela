import type { SessionListRow } from '@rivus/estela-rpc'
import { redact, redactText } from '@rivus/agent-kit/redact'
import { describe, expect, it } from 'vite-plus/test'
import { listSessionPage, type SessionSource } from './session-list.ts'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2026, 10, 1)

function row(traceId: string, fields: Partial<SessionListRow> = {}): SessionListRow {
  return { traceId, agent: 'claude-code', lastActiveAt: T0, sizeBytes: 10, pending: false, ...fields }
}

function sourceOf(rows: SessionListRow[], matches: string[] = []): SessionSource {
  return {
    listSessions: async query => ({
      agents: [
        { id: 'claude-code', displayName: 'Claude Code', count: rows.length },
        { id: 'codex', displayName: 'Codex', count: 0 },
      ],
      rows,
      complete: true,
      pricesVersion: 'test-prices',
      ...(query.query === undefined ? {} : { matches }),
      pending: 0,
      revision: 1,
    }),
  }
}

const same = <T>(value: T): T => value
/** Built from parts: the repository check rejects a literal home path in a tracked file. */
const LIST_HOME = ['', 'home', 'u'].join('/')
const tilde = (text: string): string => text.replace(LIST_HOME, '~')
const redaction = { value: same, text: tilde }

describe('listSessionPage', () => {
  const rows = [
    row('a', { cwd: '~/work/app', project: 'app', compactions: 1, failedTools: 0, lastActiveAt: T0 + 2 * DAY }),
    row('b', { cwd: '~/work/app/sub', project: 'sub', compactions: 0, failedTools: 2, lastActiveAt: T0 + DAY }),
    row('c', { cwd: '~/work/apple', project: 'apple', pending: true, lastActiveAt: T0 }),
    row('d', { agent: 'codex', error: { reason: 'bad line' }, lastActiveAt: T0 - DAY }),
  ]

  it('filters by directory, project, time, and agent', async () => {
    const ids = async (filters: Parameters<typeof listSessionPage>[1]) =>
      (await listSessionPage(sourceOf(rows), filters, redaction)).sessions.map(item => item.traceId)
    expect(await ids({ cwd: `${LIST_HOME}/work/app/` })).toEqual(['a', 'b'])
    expect(await ids({ project: 'APP' })).toEqual(['a', 'c'])
    expect(await ids({ since: '2026-11-02' })).toEqual(['a', 'b'])
    expect(await ids({ until: '2026-11-01T00:00:00Z' })).toEqual(['c', 'd'])
    expect(await ids({ agent: 'codex' })).toEqual(['d'])
  })

  it('tests flags on recorded counts and counts the sessions still unsummarized', async () => {
    const compacted = await listSessionPage(sourceOf(rows), { hasCompaction: true }, redaction, 0)
    expect(compacted.sessions.map(item => item.traceId)).toEqual(['a'])
    expect(compacted.unsummarized).toBe(1)
    const clean = await listSessionPage(sourceOf(rows), { hasFailedTools: false }, redaction, 0)
    expect(clean.sessions.map(item => item.traceId)).toEqual(['a'])
  })

  it('asks for the missing counts first and waits for them before it tests a flag', async () => {
    let summarized = false
    const asked: string[][] = []
    const source: SessionSource = {
      listSessions: async (query, redact) => {
        if (query.first) {
          asked.push(query.first)
          summarized = true
        }
        const pending = row('p', summarized ? { compactions: 2 } : { pending: true })
        return sourceOf([pending]).listSessions(query, redact)
      },
    }
    const page = await listSessionPage(source, { hasCompaction: true }, redaction, 1000)
    expect(asked).toEqual([['p']])
    expect(page.sessions.map(item => item.traceId)).toEqual(['p'])
    expect(page.unsummarized).toBeUndefined()
  })

  it('keeps search matches in activity order and marks summary state', async () => {
    const found = await listSessionPage(sourceOf(rows, ['d', 'a']), { query: 'x' }, redaction)
    expect(found.sessions.map(item => [item.traceId, item.summary])).toEqual([
      ['a', 'ready'],
      ['d', 'failed'],
    ])
    expect(found.sessions[0]!.lastActiveAt).toBe('2026-11-03T00:00:00.000Z')
  })

  it('clips long text and marks it, and rejects an agent the server does not read', async () => {
    const long = await listSessionPage(sourceOf([row('a', { title: 't'.repeat(250) })]), {}, redaction)
    expect(long.sessions[0]).toMatchObject({ title: 't'.repeat(200), truncated: [['title']] })
    await expect(listSessionPage(sourceOf(rows), { agent: 'x' }, redaction)).rejects.toThrow(
      'unknown agent "x"; this server reads claude-code, codex',
    )
  })

  it('redacts list text before cutting it', async () => {
    const home = ['', 'Users', 'alice'].join('/')
    const kit = {
      value: <T>(value: T): T => redact(value, { home }),
      text: (text: string) => redactText(text, { home }),
    }
    const prompt = `${'x'.repeat(289)} ${home}/project`
    const page = await listSessionPage(
      sourceOf([row('a', { title: `${'t'.repeat(190)} ${home}/b`, firstPrompt: prompt })]),
      {},
      kit,
    )
    expect(page.sessions[0]).toMatchObject({
      title: `${'t'.repeat(190)} ~/b`,
      firstPrompt: `${'x'.repeat(289)} ~/project`,
    })
    expect(JSON.stringify(page)).not.toContain(home.slice(0, 9))
  })

  it('replaces a home path the kit cut short in a title or a first prompt', async () => {
    const home = ['', 'Users', 'alice'].join('/')
    const kit = {
      value: <T>(value: T): T => redact(value, { home }),
      text: (text: string) => redactText(text, { home }),
    }
    // The kit's title is the first prompt cut to 80 characters, before anything redacts it.
    const prompt = `${'x'.repeat(70)} ${home}/project fix it`
    const firstPrompt = `${'y'.repeat(100)} ${home}/project`.slice(0, 110)
    const page = await listSessionPage(sourceOf([row('a', { title: prompt.slice(0, 80), firstPrompt })]), {}, kit)
    expect(page.sessions[0]).toMatchObject({ title: `${'x'.repeat(70)} ~`, firstPrompt: `${'y'.repeat(100)} ~` })
    expect(JSON.stringify(page)).not.toContain(home.slice(0, 9))
  })
})
