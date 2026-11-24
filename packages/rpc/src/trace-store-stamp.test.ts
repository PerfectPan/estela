import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Trace, TraceEvent } from '@rivus/estela-schema'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { deferred } from '../testing/store-fixture.ts'
import {
  LoadCancelledError,
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
  let prevMtimeMs = 0
  if (mtimeOffsetMs !== 0) {
    try {
      prevMtimeMs = (await stat(file)).mtimeMs
    } catch {
      prevMtimeMs = 0
    }
  }
  await writeFile(file, `${records.map(r => JSON.stringify(r)).join('\n')}\n`, 'utf8')
  if (mtimeOffsetMs !== 0) {
    const baseMs = Math.ceil(Math.max(Date.now(), prevMtimeMs) / 1000) * 1000
    const target = new Date(baseMs + mtimeOffsetMs)
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

  it('starts a fresh load for a new caller after an aborted pending load and preserves the new pending entry when the old load settles', async () => {
    const dir = await tempDir()
    const file = join(dir, 'aborted-pending.jsonl')
    await writeRecords(file, [{ id: 'u1', text: 'unchanged' }])
    const initialStamp = await stampOf(file)

    const load1Started = deferred()
    const load1Release = deferred()
    const load2Started = deferred()
    const load2Release = deferred()
    let loadCount = 0

    const store = new TraceStore({
      fs: makeNodeFs(),
      resolve: traceId =>
        traceId === 'trace-ab' ? { key: 'trace-ab', target: { path: file }, expect: initialStamp } : undefined,
      async load(session) {
        loadCount += 1
        const attempt = loadCount
        if (attempt === 1) {
          load1Started.resolve()
          // Ignore opts.signal briefly so the aborted pending entry stays in `pending` while caller B arrives.
          await load1Release.promise
        } else if (attempt === 2) {
          load2Started.resolve()
          await load2Release.promise
        }
        return { trace: await parseFile(session.target.path), canonical: false }
      },
    })

    // Caller A starts loading and then cancels before load #1 settles.
    const handleA = await store.open('trace-ab')
    await load1Started.promise
    handleA.release()

    // Caller B arrives immediately while aborted load #1 is still settling in `pending`.
    const viewB = store.view('trace-ab')
    await Promise.race([load2Started.promise, new Promise<void>(resolve => setTimeout(resolve, 50))])

    // Load #1 settles and runs its `finally`; it must not delete load #2's pending entry.
    load1Release.resolve()
    await expect(handleA.done).rejects.toBeInstanceOf(LoadCancelledError)
    expect(loadCount).toBe(2)

    // Caller C joins the still-active load #2 instead of starting a 3rd load.
    const viewC = store.view('trace-ab')
    load2Release.resolve()

    const [resB, resC] = await Promise.all([viewB, viewC])
    expect(resB.trace.events[0]!.payload).toEqual({ text: 'unchanged' })
    expect(resC.trace.events[0]!.payload).toEqual({ text: 'unchanged' })
    expect(loadCount).toBe(2)
    expect(store.cachedKeys()).toEqual(['trace-ab'])
  })

  it('serves the cached snapshot to a concurrent cold reader whose totalBytes stat resolves after the first reader caches and the log appends', async () => {
    const dir = await tempDir()
    const file = join(dir, 'concurrent-append.jsonl')
    await writeRecords(file, [{ id: 'u1', text: 'initial' }])
    const initialStamp = await stampOf(file)

    const baseFs = makeNodeFs()
    const stat1Gate = deferred()
    const stat2Entered = deferred()
    const stat2Gate = deferred()
    let statCount = 0
    const gatedFs: TraceStoreDeps['fs'] = {
      ...baseFs,
      async stat(target, options) {
        statCount += 1
        const call = statCount
        if (call === 1) {
          await stat1Gate.promise
        } else if (call === 2) {
          stat2Entered.resolve()
          await stat2Gate.promise
        }
        return baseFs.stat(target, options)
      },
    }

    let loadCount = 0
    const store = new TraceStore({
      fs: gatedFs,
      resolve: traceId =>
        traceId === 'trace-ca' ? { key: 'trace-ca', target: { path: file }, expect: initialStamp } : undefined,
      async load(session) {
        loadCount += 1
        return { trace: await parseFile(session.target.path), canonical: false }
      },
    })

    // Both cold readers enter `totalBytes` concurrently before either starts loading.
    const first = store.event('trace-ca', 'u1')
    const second = store.event('trace-ca', 'u1')
    await stat2Entered.promise

    // First reader completes and populates the cache.
    stat1Gate.resolve()
    const res1 = await first
    expect(res1.payload).toEqual({ text: 'initial' })
    expect(loadCount).toBe(1)
    expect(store.cachedKeys()).toEqual(['trace-ca'])

    // Log appends while the second reader's `totalBytes` stat is still pending.
    await writeRecords(
      file,
      [
        { id: 'u1', text: 'initial' },
        { id: 'u2', text: 'appended' },
      ],
      5000,
    )

    // Second reader resumes: it must hit the cache instead of starting a stale reload.
    stat2Gate.resolve()
    const res2 = await second
    expect(res2.payload).toEqual({ text: 'initial' })
    expect(loadCount).toBe(1)
    expect(store.cachedKeys()).toEqual(['trace-ca'])
  })
})
