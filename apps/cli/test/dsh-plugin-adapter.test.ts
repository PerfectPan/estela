import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { readOriginal } from '@rivus/agent-kit/sessions'
import type { Result } from '@rivus/agent-kit/catalog'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { dshPluginSessionAdapter } from '../src/dsh-plugin-adapter.ts'

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

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(`unexpected failure: ${JSON.stringify(result.error)}`)
  }
  return result.value
}

describe('dsh-plugin adapter', () => {
  it('normalizes uncached input plus cache usage while keeping original values and missing input', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-cache-'))
    const file = join(home, 'capture.ndjson')
    const complete = {
      v: 1,
      ts: '2026-11-10T09:00:01.000Z',
      type: 'assistant_message',
      usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 20, cacheWriteTokens: 2, costUsd: 'unknown extra' },
    }
    const partial = { ...complete, usage: { cacheReadTokens: 20 } }
    try {
      await writeFile(file, [RECORDS[0], complete, partial].map(record => JSON.stringify(record)).join('\n'))
      const platform = createNodePlatform({ home, env: {} })
      const trace = value(await dshPluginSessionAdapter.load(platform, { agent: 'dsh-plugin', path: file }))
      const first = trace.events[0]!
      const second = trace.events[1]!
      expect(first.kind === 'request' && first.payload.usage).toEqual({
        inputTokens: 32,
        outputTokens: 3,
        cacheReadTokens: 20,
        cacheWriteTokens: 2,
      })
      expect(second.kind === 'request' && second.payload.usage).toEqual({ cacheReadTokens: 20 })
      const original = await readOriginal(platform, first.source)
      expect(original.ok && original.value).toEqual(complete)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('keeps UTF-8 source bytes and physical lines while validating shapes and preserving missing usage', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-sources-'))
    const file = join(home, 'capture.ndjson')
    const start = { v: 1, ts: '2026-11-10T09:00:00.000Z', type: 'session_start', sessionId: '中文', cwd: '/项目' }
    const request = {
      v: 1,
      ts: '2026-11-10T09:00:01.000Z',
      type: 'assistant_message',
      model: '模型',
      usage: { outputTokens: 3 },
    }
    const prefix = '\r\n' + JSON.stringify(start) + '\r\nnull\r\n  \r\n'
    await writeFile(
      file,
      prefix
        + JSON.stringify(request)
        + '\r\n'
        + JSON.stringify({ ...request, usage: { inputTokens: 'bad' } })
        + '\n'
        + JSON.stringify({ ...request, ts: 'invalid' }),
    )
    const platform = createNodePlatform({ home, env: {} })
    try {
      const loaded = value(await dshPluginSessionAdapter.load(platform, { agent: 'dsh-plugin', path: file }))
      expect(loaded.events).toHaveLength(1)
      const event = loaded.events[0]!
      expect(event.source).toMatchObject({
        offset: Buffer.byteLength(prefix),
        length: Buffer.byteLength(JSON.stringify(request)) + 1,
        line: 5,
      })
      expect(event.kind === 'request' && event.payload.usage).toEqual({ outputTokens: 3 })
      expect(loaded.skipped).toHaveLength(3)
      const raw = await readOriginal(platform, event.source)
      expect(raw.ok && raw.value).toEqual(request)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('fails loudly on an unknown generation even when its envelope changes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-generation-'))
    const file = join(home, 'capture.ndjson')
    try {
      await writeFile(file, JSON.stringify(RECORDS[0]) + '\n' + JSON.stringify({ v: 2, renamedPayload: true }))
      const result = await dshPluginSessionAdapter.load(createNodePlatform({ home, env: {} }), {
        agent: 'dsh-plugin',
        path: file,
      })
      expect(result).toMatchObject({ ok: false, error: { _tag: 'UnknownFormatGeneration', line: 2 } })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

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
