import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vite-plus/test'
import { deferred, fixture, HOME, present, storeOf } from '../testing/store-fixture.ts'
import { TraceStore } from './trace-store.ts'

/** Rejections the tests read back as `Error`s; anything else keeps its string form. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * The store's cached entry for `key`. `entries` is private, so it is reached by index — a rename
 * or a type change here fails typecheck, which an assertion would hide.
 */
function cachedEntry(store: TraceStore, key: string) {
  return store['entries'].get(key)!
}

function cachedTrace(store: TraceStore, key: string): Trace {
  return cachedEntry(store, key).trace
}

describe('TraceStore lifecycle', () => {
  it('keeps no originals in the cached entry', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: 'u1', kind: 'user', text: 'x' },
      { id: 'r1', kind: 'request' },
    ])
    const { store } = storeOf({ fs: f.fs, parse: f.parse })
    await store.view('a')
    const trace = cachedTrace(store, 'a')
    expect(trace.events).toHaveLength(2)
    expect(trace.events.some(event => 'original' in event)).toBe(false)
  })

  it('keeps no originals in a cached canonical entry after get-event', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user', text: 'x' }])
    const store = new TraceStore({
      resolve: traceId => ({ key: traceId, target: { path: '/logs/a.jsonl' } }),
      fs: f.fs,
      load: async session => ({ trace: f.parse(session.target.path), canonical: true }),
    })
    expect((await store.event('a', 'u1')).original).toEqual({ id: 'u1', kind: 'user', text: 'x' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const entry = cachedEntry(store, 'a')
    expect(entry.trace.events.some(event => 'original' in event)).toBe(false)
    expect(entry.reload).toBeUndefined()
    expect(JSON.stringify(Object.values(entry).filter(value => !(value instanceof Map)))).not.toContain('"original"')
  })

  it('the latest open from one connection wins even when an earlier open is slower', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user' }])
    f.write('/logs/b.jsonl', [{ id: 'u1', kind: 'user' }])
    const slow = deferred()
    let slowDone = false
    const fs = {
      ...f.fs,
      async stat(file: string) {
        if (file === '/logs/a.jsonl' && !slowDone) {
          await slow.promise
        }
        return f.fs.stat(file)
      },
    }
    const { store, signals, gates } = storeOf({ fs, parse: f.parse })
    gates.set('b', deferred())
    const browser = {}
    const first = store.open('a', browser)
    const second = await store.open('b', browser)
    slowDone = true
    slow.resolve()
    await expect(first).rejects.toThrow('load of a was cancelled')
    expect(signals.get('b')!.aborted).toBe(false)
    // The superseded open never started a load of `a`.
    expect(signals.has('a')).toBe(false)
    gates.get('b')!.resolve()
    await second.done
    expect(store.cachedKeys()).toEqual(['b'])
  })

  it('a read from another client is not cancelled when the browser supersedes the same load', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user' }])
    f.write('/logs/b.jsonl', [{ id: 'u1', kind: 'user' }])
    const { store, signals, gates } = storeOf({ fs: f.fs, parse: f.parse })
    gates.set('a', deferred())
    const browser = {}
    await store.open('a', browser)
    // An MCP `reconstruct` (no owner) joins the running load.
    const mcp = store.reconstruct('a', 'u1')
    await new Promise(resolve => setTimeout(resolve, 0))
    await store.open('b', browser)
    expect(signals.get('a')!.aborted).toBe(false)
    gates.get('a')!.resolve()
    await expect(mcp).resolves.toMatchObject({ visibleIds: ['u1'] })
  })

  it('redacts load errors before they leave the store', async () => {
    const f = fixture()
    const store = new TraceStore({
      resolve: traceId => ({ key: traceId, target: { path: `${HOME}/logs/${traceId}.jsonl` } }),
      fs: f.fs,
      present,
      load: async () => {
        throw new Error(`codex: ${HOME}/logs/a.jsonl:3: invalid JSON`)
      },
    })
    const failure = await store.view('a').then(
      () => undefined,
      (error: unknown) => asError(error),
    )
    expect(failure?.message).toBe('codex: ~/logs/a.jsonl:3: invalid JSON')
    const handle = await store.open('b', {})
    const done = await handle.done.then(
      () => undefined,
      (error: unknown) => asError(error),
    )
    if (!(done instanceof Error)) {
      throw new Error('open of b was expected to fail')
    }
    expect(done.message).not.toContain(HOME)
  })

  it('keeps originals readable when a live file grows, and says so when a record changed or is gone', async () => {
    const f = fixture()
    const first = { id: 'u1', kind: 'user', text: 'AAAA', uuid: 'one' }
    const second = { id: 'r1', kind: 'request', text: 'BBBB', uuid: 'two' }
    const body = `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`
    f.put('/logs/a.jsonl', body)
    const { store } = storeOf({ fs: f.fs, parse: f.parse })
    await store.view('a')

    f.put('/logs/a.jsonl', `${body}${JSON.stringify({ id: 'x', kind: 'user' })}\n`)
    expect((await store.event('a', 'r1')).original).toEqual(second)

    f.put('/logs/a.jsonl', body.replace('"uuid":"two"', '"uuid":"TWO"'))
    const changed = await store.event('a', 'r1')
    expect(changed.original).toBeUndefined()
    expect(changed.originalUnavailable).toMatch(/line 2 holds a different record/)

    f.put('/logs/a.jsonl', `${JSON.stringify(first)}\n`)
    const gone = await store.event('a', 'r1')
    expect(gone.originalUnavailable).toMatch(/shrank since it was loaded; line 2 is gone/)
    expect((await store.event('a', 'u1')).original).toEqual(first)
  })

  it('logs once and marks the view when even the 256-character floor exceeds the budget', async () => {
    const events: TraceEvent[] = Array.from({ length: 60_000 }, (_, index) => ({
      id: `e${index}`,
      seq: index,
      ts: index,
      kind: 'user',
      payload: { text: 'y'.repeat(200) },
      source: { file: '/logs/big.jsonl', offset: index, length: 1, line: index + 1 },
    }))
    const trace: Trace = {
      schema: 'agent-trace',
      agent: 'test',
      session: { id: 'big' },
      capabilities: [],
      agents: [],
      events,
      skipped: [],
    }
    const logs: string[] = []
    const store = new TraceStore({
      resolve: traceId => ({ key: traceId, target: { path: '/logs/big.jsonl' } }),
      fs: {
        read: async function* () {
          yield new Uint8Array()
        },
        stat: async () => ({ kind: 'file', size: 1, mtimeMs: 0 }),
      },
      load: async () => ({ trace, canonical: false }),
      log: message => logs.push(message),
    })
    const view = await store.view('big')
    await store.view('big')
    expect(view.trace.view).toMatchObject({ maxString: 256, withinBudget: false })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/at the 256-character floor, over the \d+-byte budget/)
  }, 60_000)
})
