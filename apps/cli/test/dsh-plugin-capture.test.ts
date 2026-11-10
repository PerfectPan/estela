import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as z from 'zod/mini'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { readOriginal } from '@rivus/agent-kit/sessions'
import { afterEach, expect, it } from 'vite-plus/test'
import { SessionCatalog } from '../src/catalog.ts'
import { buildDshTracePluginSource } from '../src/dsh-plugin.ts'
import { loadSession, sessionLoader } from '../src/session.ts'
import { createTraceStore } from '../src/trace-store.ts'
import { reportOf } from '../src/report.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-capture-'))
  roots.push(root)
  return root
}

/** Execute the shipped generated module, with the callback signatures from dsh's Cordis events. */
async function capture(root: string, tracesDir = join(root, 'captures')) {
  const path = join(root, 'plugin.mjs')
  await writeFile(path, buildDshTracePluginSource(tracesDir))
  const plugin = z.parse(
    z.object({ apply: z.function({ input: [z.unknown()] }) }),
    await import(pathToFileURL(path).href),
  )
  const hooks = new Map<string, (...args: unknown[]) => unknown>()
  await plugin.apply({
    on(event: string, listener: (...args: unknown[]) => unknown) {
      hooks.set(event, listener)
    },
  })
  return {
    tracesDir,
    async emit(event: string, ...args: unknown[]) {
      const callback = hooks.get(event)
      if (!callback) {
        throw new Error('unregistered hook: ' + event)
      }
      await callback(...args)
    },
  }
}

const session = (id: string, cwd?: string) => ({ id, header: { id, ...(cwd === undefined ? {} : { cwd }) } })
const assistant = (model: string) => ({
  type: 'assistant/message',
  data: { message: { source: { kind: 'model', model } }, usage: { inputTokens: 12, outputTokens: 3 } },
})
const records = z.array(z.looseObject({ v: z.literal(1), type: z.string(), sessionId: z.optional(z.string()) }))
async function readRecords(path: string) {
  return z.parse(
    records,
    (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as unknown),
  )
}

it('isolates concurrent sessions, records resumed agents, and flushes before original/report reads', async () => {
  const root = await tempRoot()
  const runtime = await capture(root)
  const a = session('a/中文', '/work/项目')
  const b = session('b')
  await runtime.emit('session/created', a)
  await runtime.emit('agent/created', { agent: { session: a } })
  await runtime.emit('agent/created', { agent: { session: b } })
  await runtime.emit('agent/status', { agent: { session: a }, status: 'running' })
  await runtime.emit('session/event', a, { type: 'turn/start', data: { turn: 1 } })
  await runtime.emit('session/event', a, assistant('model-a'))
  await runtime.emit('session/event', b, assistant('model-b'))
  await runtime.emit('tools/result', { agent: { session: a }, callId: 'a-tool', name: 'shell' }, { isError: false })
  await runtime.emit('agent/disposed', { agent: { session: a } })
  // Agent replacement need not dispose the Session; later messages still belong to the same capture.
  await runtime.emit('agent/created', { agent: { session: a } })
  await runtime.emit('agent/turn-stopping', { agent: { session: a }, turn: 1 })
  await runtime.emit('session/event', a, assistant('model-resumed'))
  await runtime.emit('session/event', a, { type: 'turn/end', data: { turn: 1 } })
  await runtime.emit('agent/status', { agent: { session: a }, status: 'idle' })
  await runtime.emit('agent/turn-stopping', { agent: { session: b }, turn: 1 })
  await runtime.emit('session/disposed', a)
  await runtime.emit('session/disposed', b)
  await runtime.emit('session/flush', b)
  const files = (await readdir(runtime.tracesDir)).sort()
  expect(files).toEqual([encodeURIComponent(a.id) + '.ndjson', 'b.ndjson'].sort())
  const aPath = join(runtime.tracesDir, encodeURIComponent(a.id) + '.ndjson')
  const aRecords = await readRecords(aPath)
  expect(aRecords[0]).toMatchObject({ type: 'session_start', sessionId: a.id, cwd: '/work/项目' })
  expect(aRecords.filter(record => record.type === 'session_start')).toHaveLength(1)
  expect(aRecords.filter(record => record.type === 'assistant_message').map(record => record.model)).toEqual([
    'model-a',
    'model-resumed',
  ])
  expect(aRecords.at(-1)?.type).toBe('session_end')
  expect(aRecords.filter(record => record.type === 'turn_started')).toHaveLength(1)
  expect(aRecords.filter(record => record.type === 'turn_ended')).toHaveLength(1)
  expect(aRecords.filter(record => record.type === 'turn_stopping')).toHaveLength(1)
  expect(
    (await readRecords(join(runtime.tracesDir, 'b.ndjson')))
      .filter(record => record.type === 'assistant_message')
      .map(record => record.model),
  ).toEqual(['model-b'])
  expect((await stat(aPath)).mode & 0o777).toBe(0o600)
  const platform = createNodePlatform({ home: root, env: { DSH_AGENT_TRACE_DIR: runtime.tracesDir } })
  const target = { path: aPath }
  const direct = await sessionLoader(target, platform)()
  expect(direct.session.id).toBe(a.id)
  expect(direct.events.filter(event => event.kind === 'request')).toHaveLength(2)
  for (const event of direct.events) {
    const original = await readOriginal(platform, event.source)
    expect(original.ok && original.value).toEqual(event.original)
  }
  const catalog = new SessionCatalog({ platform, noIndex: true })
  try {
    await catalog.whenIdle()
    const row = (await catalog.listSessions()).rows.find(row => row.requests === 2)
    expect(row?.error).toBeUndefined()
    expect(row).toBeDefined()
    const traces = createTraceStore({ platform, redacts: false, resolve: id => catalog.resolve(id) })
    const traceId = row!.traceId
    await traces.store.view(traceId)
    for (const event of direct.events) {
      const detail = await traces.store.event(traceId, event.id)
      expect(detail.originalUnavailable).toBeUndefined()
      expect(detail.original).toEqual(event.original)
    }
    const report = await traces.store.withEvents(traceId, full => reportOf(traces.store, traceId, full))
    expect(report.events).toHaveLength(direct.events.length)
    expect(report.events.every(event => event.original !== undefined)).toBe(true)
  } finally {
    catalog.close()
  }
})

it('contains each failed write and recovers the metadata after storage is restored', async () => {
  const root = await tempRoot()
  const dir = join(root, 'captures')
  await writeFile(dir, 'blocked directory')
  const runtime = await capture(root, dir)
  const active = session('recovered')
  await runtime.emit('agent/created', { agent: { session: active } })
  await runtime.emit('session/event', active, assistant('lost'))
  await runtime.emit('session/flush', active)
  await rm(dir)
  await mkdir(dir)
  await runtime.emit('session/event', active, assistant('recovered'))
  await runtime.emit('session/disposed', active)
  await runtime.emit('session/flush', active)
  const path = join(dir, 'recovered.ndjson')
  expect((await readRecords(path)).map(record => record.type)).toEqual([
    'session_start',
    'assistant_message',
    'session_end',
  ])
  const trace = await loadSession({ path }, { platform: createNodePlatform({ home: root, env: {} }) })
  expect(trace.session.id).toBe('recovered')
  expect(trace.events).toHaveLength(1)
})

it('contains callback and serialization failures while the flush checkpoint still awaits later records', async () => {
  const root = await tempRoot()
  const runtime = await capture(root)
  for (const event of [
    'session/created',
    'agent/created',
    'agent/status',
    'session/event',
    'tools/result',
    'agent/turn-stopping',
    'agent/disposed',
    'session/disposed',
  ]) {
    await expect(runtime.emit(event)).resolves.toBeUndefined()
  }
  const active = session('guarded')
  await runtime.emit('agent/created', { agent: { session: active } })
  await expect(runtime.emit('session/event', active, { type: 'assistant/message', data: {} })).resolves.toBeUndefined()
  await expect(runtime.emit('tools/result', { agent: { session: active } })).resolves.toBeUndefined()
  await expect(
    runtime.emit('session/event', active, {
      type: 'assistant/message',
      data: { message: { source: { model: 'bad' } }, usage: { inputTokens: 1n } },
    }),
  ).resolves.toBeUndefined()
  await runtime.emit('session/event', active, assistant('healthy'))
  await runtime.emit('session/disposed', active)
  await runtime.emit('session/flush', active)
  const captured = await readRecords(join(runtime.tracesDir, 'guarded.ndjson'))
  expect(captured.map(record => record.type)).toEqual(['session_start', 'assistant_message', 'session_end'])
  expect(captured[1]?.model).toBe('healthy')
})

it('retries session metadata after a synchronous capture failure', async () => {
  const root = await tempRoot()
  const runtime = await capture(root)
  const header: { cwd: bigint | string } = { cwd: 1n }
  const active = { id: 'metadata-recovered', header }
  await expect(runtime.emit('agent/created', { agent: { session: active } })).resolves.toBeUndefined()
  header.cwd = '/restored'
  await runtime.emit('session/event', active, assistant('healthy'))
  await runtime.emit('session/flush', active)
  const path = join(runtime.tracesDir, 'metadata-recovered.ndjson')
  const captured = await readRecords(path)
  expect(captured.map(record => record.type)).toEqual(['session_start', 'assistant_message'])
  const trace = await loadSession({ path }, { platform: createNodePlatform({ home: root, env: {} }) })
  expect(trace.session).toMatchObject({ id: active.id, cwd: '/restored' })
})
