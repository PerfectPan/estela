import type { SessionAdapter } from '@rivus/agent-kit/sessions'
import type { IndexHead, IndexRow, SessionIndex, StoredSummary } from '@rivus/estela-runtime-node'
import type { SessionsSignal } from '@rivus/estela-rpc'
import { ok } from '@rivus/agent-kit/catalog'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { bindSessionPublisher } from '@rivus/estela-rpc'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { SessionCatalog } from './session-catalog.ts'

const source = { file: 'fixture', offset: 0, length: 1, line: 1 }
const dirs: string[] = []
const catalogs: SessionCatalog[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const catalog of catalogs.splice(0)) {
    catalog.close()
  }
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * Waits for a step that runs on its own, without a timer: up to 10 s of the wall clock. A summary reads the
 * disk in the thread pool, so a count of event loop turns runs out on a busy machine. `Date.now()` and
 * `setImmediate` stay real where the tests fake `setTimeout`.
 */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!condition() && Date.now() < deadline) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  expect(condition(), 'the step did not run within 10 s').toBe(true)
}

/** Every event loop turn for a while, so that work already in flight gets to where it waits or ends. */
async function settle(): Promise<void> {
  for (let turns = 0; turns < 50; turns++) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
}

/** What waits for it resumes when `open` is called. */
function gate(): { passed: Promise<void>; open: () => void } {
  let open: () => void = () => {}
  const passed = new Promise<void>(resolve => {
    open = resolve
  })
  return { passed, open }
}

/**
 * The session index in memory, recording each call by name. A real index takes no write after its
 * `close()` and the catalog swallows the error, so the calls are what tells whether one was made.
 */
function memoryIndex(): { index: SessionIndex; calls: string[] } {
  const calls: string[] = []
  const heads = new Map<string, IndexHead>()
  const summaries = new Map<string, StoredSummary>()
  const rowOf = (head: IndexHead): IndexRow => {
    const summary = summaries.get(head.traceId)
    return summary ? { ...head, summary } : { ...head }
  }
  return {
    calls,
    index: {
      file: '',
      enabled: true,
      rows: () => [...heads.values()].map(rowOf),
      remove: traceIds => {
        calls.push('remove')
        for (const traceId of traceIds) {
          heads.delete(traceId)
        }
      },
      get: (traceId, size, mtimeMs) => {
        const head = heads.get(traceId)
        return head?.size === size && head.mtimeMs === mtimeMs ? summaries.get(traceId) : undefined
      },
      putHeads: rows => {
        calls.push('putHeads')
        for (const row of rows) {
          if (heads.get(row.traceId)?.size !== row.size || heads.get(row.traceId)?.mtimeMs !== row.mtimeMs) {
            summaries.delete(row.traceId)
          }
          heads.set(row.traceId, row)
        }
      },
      putSummaries: rows => {
        calls.push('putSummaries')
        for (const row of rows) {
          summaries.set(row.traceId, row.summary)
        }
      },
      search: () => undefined,
      close: () => {
        calls.push('close')
      },
    },
  }
}

interface FakeAdapter {
  root: string
  /** Each load of a session adds its path here. */
  loads: string[]
  /** Awaits before the first session is listed; the pass is still running meanwhile. */
  listing?: Promise<void>
  /** Awaits inside each load; the summary is still running meanwhile. */
  loading?: Promise<void>
}

/** One session per `*.jsonl` file under `root`, each summarized through a load. */
function fakeAdapter(options: FakeAdapter): SessionAdapter {
  return {
    specificationVersion: 'sessions-v1',
    agent: 'fake',
    displayName: 'Fake',
    // The fake ignores `home`; the rule only satisfies `sessionAdapterHome`.
    home: { defaultPath: [] },
    capabilities: ['requests'],
    roots: () => [options.root],
    async *discover(_platform, dir) {
      await options.listing
      const names = (await readdir(dir)).toSorted()
      for (const name of names) {
        yield { ref: { agent: 'fake', path: join(dir, name) }, title: name, lastActiveAt: 1_000, sizeBytes: 1 }
      }
    },
    async detect() {
      return false
    },
    async load(_platform, ref) {
      options.loads.push(ref.path)
      await options.loading
      return ok({
        agent: 'fake',
        session: { id: ref.path },
        capabilities: ['requests', 'usage'],
        agents: [{ id: 'main' }],
        events: [
          { id: 'u', seq: 0, ts: 1, kind: 'user', payload: { text: 'run' }, source },
          { id: 'r', seq: 1, ts: 2, kind: 'request', payload: { usage: { inputTokens: 12, outputTokens: 3 } }, source },
        ],
        skipped: [],
      })
    },
  }
}

/** A catalog over the session index in memory, with `count` session files under its home. */
async function catalogOf(count: number, adapter: Partial<FakeAdapter> = {}) {
  const home = await mkdtemp(join(tmpdir(), 'catalog-close-'))
  dirs.push(home)
  const root = join(home, 'sessions')
  await mkdir(root)
  for (let n = 1; n <= count; n++) {
    await writeFile(join(root, `${n}.jsonl`), 'x')
  }
  const loads: string[] = []
  const { index, calls } = memoryIndex()
  const catalog = new SessionCatalog({
    adapters: { fake: fakeAdapter({ root, loads, ...adapter }) },
    platform: createNodePlatform({ home, env: {} }),
    index,
  })
  catalogs.push(catalog)
  return { catalog, calls, loads }
}

/** `idle` when it settles first, else `pending` after a second: a `whenIdle()` that hangs fails here, not at the test's timeout. */
function settled(idle: Promise<unknown>): Promise<'idle' | 'pending'> {
  return Promise.race([
    idle.then(() => 'idle'),
    new Promise(resolve => setTimeout(() => resolve('pending'), 1_000)),
  ]) as Promise<'idle' | 'pending'>
}

describe('closing the session catalog', () => {
  it('drops the summaries that wait: none runs after close(), and whenIdle() resolves', async () => {
    const loading = gate()
    const { catalog, calls, loads } = await catalogOf(6, { loading: loading.passed })
    // Four summaries run at once and hold on the gate; two wait behind them.
    const idle = catalog.whenIdle()
    await until(() => loads.length === 4)
    const before = calls.length
    catalog.close()
    loading.open()
    expect(await settled(idle)).toBe('idle')
    await settle()
    expect(loads).toHaveLength(4)
    expect(calls.slice(before)).toEqual(['close'])
  })

  it('drops a summary that ends after close(): no index write, no flush timer, no announcement', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const announcements: SessionsSignal[] = []
    bindSessionPublisher(signal => announcements.push(signal))
    const loading = gate()
    const { catalog, calls, loads } = await catalogOf(1, { loading: loading.passed })
    await catalog.discovered()
    await until(() => loads.length === 1)
    catalog.close()
    const touched = calls.length
    const announced = announcements.length
    expect(vi.getTimerCount()).toBe(0)
    loading.open()
    await settle()
    expect(vi.getTimerCount()).toBe(0)
    expect(calls.slice(touched)).toEqual([])
    expect(announcements).toHaveLength(announced)
    expect((await catalog.listSessions()).rows[0]).toMatchObject({ pending: true })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls.slice(touched)).toEqual([])
    expect(announcements).toHaveLength(announced)
  })

  it('writes, flushes on its timer, and announces a summary that ends while the catalog is open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const announcements: SessionsSignal[] = []
    bindSessionPublisher(signal => announcements.push(signal))
    const { catalog, calls, loads } = await catalogOf(1)
    await catalog.discovered()
    await until(() => loads.length === 1 && vi.getTimerCount() === 1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls.filter(call => call === 'putSummaries')).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    expect((await catalog.listSessions()).rows[0]).toMatchObject({ pending: false, requests: 1 })
    expect(announcements.filter(signal => signal.pending === 0)).toHaveLength(1)
  })

  it('resolves a whenIdle() that waits on a running summary when the catalog closes, without announcing', async () => {
    const announcements: SessionsSignal[] = []
    bindSessionPublisher(signal => announcements.push(signal))
    const loading = gate()
    const { catalog, loads } = await catalogOf(1, { loading: loading.passed })
    const idle = catalog.whenIdle()
    await until(() => loads.length === 1)
    catalog.close()
    // `close()` announces the batch it writes; that one is the last.
    const announced = announcements.length
    expect(await settled(idle)).toBe('idle')
    // The summary is still running here: nothing was announced for it.
    expect(announcements).toHaveLength(announced)
  })

  it('indexes, queues, and announces nothing for a discover pass that ends after close()', async () => {
    const announcements: SessionsSignal[] = []
    bindSessionPublisher(signal => announcements.push(signal))
    const listing = gate()
    const { catalog, calls, loads } = await catalogOf(1, { listing: listing.passed })
    // The pass is in flight here: it cannot list a session before `listing` opens.
    const started = catalog.start()
    catalog.close()
    const touched = calls.length
    const announced = announcements.length
    listing.open()
    await started
    await settle()
    expect(calls.slice(touched)).toEqual([])
    expect(loads).toEqual([])
    expect(announcements).toHaveLength(announced)
  })
})
