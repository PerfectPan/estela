import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { dshPluginSessionAdapter } from './dsh-plugin-adapter.ts'

const SESSION_ID = '01abc-trace'
const RECORDS = [
  { v: 1, ts: '2026-11-10T09:00:00.000Z', type: 'session_start', sessionId: SESSION_ID, cwd: '/work/demo' },
  { v: 1, ts: '2026-11-10T09:00:01.000Z', type: 'turn_started' },
  {
    v: 1,
    ts: '2026-11-10T09:00:02.000Z',
    type: 'assistant_message',
    model: 'deepseek-chat',
    usage: { inputTokens: 120, outputTokens: 30 },
  },
  { v: 1, ts: '2026-11-10T09:00:03.000Z', type: 'tool_result' },
  { v: 1, ts: '2026-11-10T09:00:04.000Z', type: 'session_event', eventType: 'goal_updated' },
  { v: 1, ts: '2026-11-10T09:00:05.000Z', type: 'turn_ended' },
  { v: 1, ts: '2026-11-10T09:00:06.000Z', type: 'session_end' },
  'not json at all',
]

afterEach(async () => {
  // Each test builds its own traces dir under a temp home; the platform reads only what it is given.
})

function value<T>(result: { ok: boolean; value?: T; error?: unknown }): T {
  if (!result.ok) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`)
  }
  return result.value as T
}

describe('dsh-plugin adapter', () => {
  it('folds the trace into one request per model message and system markers', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-trace-dsh-adapter-'))
    const file = join(home, 'agent-trace', `${SESSION_ID}.ndjson`)
    await mkdir(join(home, 'agent-trace'), { recursive: true })
    await writeFile(
      file,
      RECORDS.map(record => (typeof record === 'string' ? record : JSON.stringify(record))).join('\n'),
    )
    const platform = createNodePlatform({ home, env: {} })
    const loaded = value(await dshPluginSessionAdapter.load(platform, { agent: 'dsh-plugin', path: file }))
    expect(loaded.session).toMatchObject({
      id: SESSION_ID,
      cwd: '/work/demo',
      startedAt: Date.parse('2026-11-10T09:00:00.000Z'),
    })
    const kinds = loaded.events.map(event => event.kind)
    // The endpoints carry no event; the message is one request; the rest are system markers.
    expect(kinds).toEqual(['system', 'request', 'system', 'system', 'system'])
    const request = loaded.events[1]!
    expect(request.kind === 'request' && request.payload.granularity).toBe('request')
    expect(request.kind === 'request' && request.payload.model).toBe('deepseek-chat')
    expect(request.kind === 'request' && request.payload.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
    expect(request.ts).toBe(Date.parse('2026-11-10T09:00:02.000Z'))
    // Events are numbered in order, ids unique per line.
    expect(loaded.events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4])
    // The torn line is a skip, not a failure.
    expect(loaded.skipped.map(skip => skip.reason)).toEqual(['invalid-json'])
    await rm(home, { recursive: true, force: true }).catch(() => {})
  })

  it('discovers the trace files under the home and names the session from the first record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-trace-dsh-adapter-'))
    const dir = join(home, 'agent-trace')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, `${SESSION_ID}.ndjson`), JSON.stringify(RECORDS[0]))
    await writeFile(join(dir, 'ignore.txt'), 'x')
    const platform = createNodePlatform({ home, env: {} })
    const root = dshPluginSessionAdapter.roots({ agent: 'dsh-plugin', path: home, source: { kind: 'default' } })[0]!
    const heads = []
    for await (const head of dshPluginSessionAdapter.discover(platform, root)) {
      heads.push(head)
    }
    expect(heads).toHaveLength(1)
    const found = heads[0]!
    expect(!('error' in found)).toBe(true)
    expect(found.ref).toMatchObject({
      agent: 'dsh-plugin',
      path: join(dir, `${SESSION_ID}.ndjson`),
      sessionId: SESSION_ID,
    })
    expect(found).toMatchObject({ cwd: '/work/demo' })
    // detect recognises its own files by shape, cheaply.
    expect(
      await dshPluginSessionAdapter.detect(platform, { agent: 'dsh-plugin', path: join(dir, `${SESSION_ID}.ndjson`) }),
    ).toBe(true)
    expect(
      await dshPluginSessionAdapter.detect(platform, { agent: 'dsh-plugin', path: join(home, 'other.jsonl') }),
    ).toBe(false)
    await rm(home, { recursive: true, force: true }).catch(() => {})
  })

  it('lists nothing when the home has no traces directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agent-trace-dsh-adapter-'))
    const platform = createNodePlatform({ home, env: {} })
    const heads = []
    for await (const head of dshPluginSessionAdapter.discover(platform, join(home, 'agent-trace'))) {
      heads.push(head)
    }
    expect(heads).toEqual([])
    await rm(home, { recursive: true, force: true }).catch(() => {})
  })
})
