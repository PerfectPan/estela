import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Trace, TraceEvent } from '@rivus/estela-schema'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { deferred } from '../testing/store-fixture.ts'
import {
  SnapshotChangedError,
  TraceStore,
  type FileStamp,
  type ResolvedSession,
  type TraceStoreDeps,
} from './trace-store.ts'

const dirs: string[] = []
const encoder = new TextEncoder()
const recordSchema = z.object({ id: z.string(), text: z.string() })

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'estela-stamp-'))
  dirs.push(dir)
  return dir
}

function makeNodeFs(): TraceStoreDeps['fs'] {
  return {
    async *read(file, range) {
      const bytes = await readFile(file)
      if (range) {
        yield bytes.subarray(range.start, range.end)
        return
      }
      yield bytes
    },
    async stat(file) {
      try {
        const info = await stat(file)
        return { kind: 'file', size: info.size, mtimeMs: info.mtimeMs }
      } catch {
        return undefined
      }
    },
  }
}

async function parseFile(file: string): Promise<Trace> {
  const raw = await readFile(file, 'utf8')
  const events: TraceEvent[] = []
  let offset = 0
  let line = 1
  for (const text of raw.split('\n')) {
    const length = encoder.encode(text).byteLength
    if (text) {
      const original: unknown = JSON.parse(text)
      const parsed = z.parse(recordSchema, original)
      events.push({
        id: parsed.id,
        seq: events.length,
        ts: events.length,
        kind: 'user',
        payload: { text: parsed.text },
        source: { file, offset, length, line },
        original,
      })
    }
    offset += length + 1
    line += 1
  }
  return {
    schema: 'estela',
    agent: 'test',
    session: { id: file },
    capabilities: ['requests'],
    agents: [{ id: 'main' }],
    events,
    skipped: [],
  }
}

async function stampOf(file: string): Promise<FileStamp> {
  const info = await stat(file)
  return { size: info.size, mtimeMs: info.mtimeMs }
}

async function writeRecords(
  file: string,
  records: readonly { id: string; text: string }[],
  mtimeOffsetMs = 0,
): Promise<void> {
  await writeFile(file, `${records.map(r => JSON.stringify(r)).join('\n')}\n`, 'utf8')
  if (mtimeOffsetMs !== 0) {
    const target = new Date(Date.now() + mtimeOffsetMs)
    await utimes(file, target, target)
  }
}

describe('TraceStore expect stamp invariant', () => {
  it('throws SnapshotChangedError without caching when the file changes during load and leaks no path', async () => {
    const dir = await tempDir()
    const file = join(dir, 'secret-session.jsonl')
    await writeRecords(file, [{ id: 'u1', text: 'initial' }])
    const initialStamp = await stampOf(file)

    const gate = deferred()
    const started = deferred()
    const store = new TraceStore({
      fs: makeNodeFs(),
      resolve: traceId =>
        traceId === 'trace-a' ? { key: 'trace-a', target: { path: file }, expect: initialStamp } : undefined,
      async load(session) {
        started.resolve()
        await gate.promise
        return { trace: await parseFile(session.target.path), canonical: false }
      },
    })

    const viewCall = store.view('trace-a')
    await started.promise
    await writeRecords(file, [{ id: 'u1', text: 'rewritten during load' }], 5000)
    gate.resolve()

    const err: unknown = await viewCall.catch((reason: unknown) => reason)
    expect(err).toBeInstanceOf(SnapshotChangedError)
    expect(err instanceof Error ? err.message : '').not.toContain(dir)
    expect(err instanceof Error ? err.message : '').not.toContain('secret-session.jsonl')
    expect(store.cachedKeys()).toEqual([])
  })

  it('rejects all concurrent waiters sharing an in-flight load with SnapshotChangedError', async () => {
    const dir = await tempDir()
    const file = join(dir, 'concurrent.jsonl')
    await writeRecords(file, [{ id: 'u1', text: 'hello' }])
    const initialStamp = await stampOf(file)

    const gate = deferred()
    const started = deferred()
    const store = new TraceStore({
      fs: makeNodeFs(),
      resolve: traceId =>
        traceId === 'trace-c' ? { key: 'trace-c', target: { path: file }, expect: initialStamp } : undefined,
      async load(session) {
        started.resolve()
        await gate.promise
        return { trace: await parseFile(session.target.path), canonical: false }
      },
    })

    const first = store.event('trace-c', 'u1')
    await started.promise
    const second = store.event('trace-c', 'u1')

    await writeRecords(file, [{ id: 'u1', text: 'replacement' }], 5000)
    gate.resolve()

    await expect(first).rejects.toBeInstanceOf(SnapshotChangedError)
    await expect(second).rejects.toBeInstanceOf(SnapshotChangedError)
    expect(store.cachedKeys()).toEqual([])
  })

  it('throws SnapshotChangedError when an evicted session is reloaded after its file changed', async () => {
    const dir = await tempDir()
    const sessions = new Map<string, ResolvedSession>()
    const files: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const file = join(dir, `s-${index}.jsonl`)
      await writeRecords(file, [{ id: 'u1', text: `msg-${index}` }])
      files.push(file)
      sessions.set(`t-${index}`, { key: `t-${index}`, target: { path: file }, expect: await stampOf(file) })
    }

    const store = new TraceStore({
      fs: makeNodeFs(),
      resolve: traceId => sessions.get(traceId),
      load: async session => ({ trace: await parseFile(session.target.path), canonical: false }),
    })

    for (let index = 0; index < 4; index += 1) {
      await store.view(`t-${index}`)
    }
    expect(store.cachedKeys()).toEqual(['t-1', 't-2', 't-3'])

    await writeRecords(files[0]!, [{ id: 'u1', text: 'changed after eviction' }], 5000)

    await expect(store.event('t-0', 'u1')).rejects.toBeInstanceOf(SnapshotChangedError)
    expect(store.cachedKeys()).toEqual(['t-1', 't-2', 't-3'])
  })

  it('preserves existing caching behavior when expect is omitted', async () => {
    const dir = await tempDir()
    const file = join(dir, 'no-expect.jsonl')
    await writeRecords(file, [{ id: 'u1', text: 'v1' }])

    const gate = deferred()
    const started = deferred()
    const store = new TraceStore({
      fs: makeNodeFs(),
      resolve: traceId => (traceId === 'dev-id' ? { key: 'dev-id', target: { path: file } } : undefined),
      async load(session) {
        started.resolve()
        await gate.promise
        return { trace: await parseFile(session.target.path), canonical: false }
      },
    })

    const viewCall = store.view('dev-id')
    await started.promise
    await writeRecords(file, [{ id: 'u1', text: 'v2' }], 5000)
    gate.resolve()

    const view = await viewCall
    expect(view.trace.events[0]!.payload).toEqual({ text: 'v2' })
    expect(store.cachedKeys()).toEqual(['dev-id'])
  })
})
