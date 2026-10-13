import type { LoadProgress } from './trace-store.ts'
import { describe, expect, it } from 'vite-plus/test'
import { deferred, fixture, HOME, present, storeOf } from '../testing/store-fixture.ts'
import { LoadCancelledError, TraceStore } from './trace-store.ts'

const encoder = new TextEncoder()

describe('TraceStore', () => {
  it('get-event reads the original back from the source pointer, not from memory', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: 'u1', kind: 'user', text: 'hello' },
      { id: 'r1', kind: 'request', text: 'AAAA' },
    ])
    const { store } = storeOf({ fs: f.fs, parse: f.parse })
    const view = await store.view('a')
    expect(view.trace.events.every(event => !('original' in event))).toBe(true)

    // Same length, different bytes: only a read of the file can see this.
    const bytes = f.files.get('/logs/a.jsonl')!
    const text = new TextDecoder().decode(bytes).replace('AAAA', 'BBBB')
    f.files.set('/logs/a.jsonl', encoder.encode(text))
    const event = await store.event('a', 'r1')
    expect(event.original).toEqual({ id: 'r1', kind: 'request', text: 'BBBB' })
    expect(event.payload).toEqual({ text: 'AAAA' })
    const line = encoder.encode(`${JSON.stringify({ id: 'u1', kind: 'user', text: 'hello' })}\n`).byteLength
    expect(f.reads.at(-1)).toEqual({ file: '/logs/a.jsonl', start: line, end: line + event.source.length })
    await expect(store.event('a', 'nope')).rejects.toThrow('no event nope')
  })

  it('returns the full payload in get-event while the view is capped and presented', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user', text: `${HOME} ${'x'.repeat(300)}` }])
    const { store } = storeOf({ fs: f.fs, parse: f.parse, present, maxString: 256 })
    const view = await store.view('a')
    expect(view.trace.events[0]!.payload).toEqual({ text: `~ ${'x'.repeat(254)}`, $truncated: [['text']] })
    expect(view.summary).toMatchObject({ requests: 0 })
    const full = await store.event('a', 'u1')
    expect(full.payload.text).toBe(`~ ${'x'.repeat(300)}`)
    expect(JSON.stringify(full)).not.toContain(HOME)
  })

  it('keeps the last 3 traces and evicts the least recently used', async () => {
    const f = fixture()
    for (const name of ['a', 'b', 'c', 'd']) {
      f.write(`/logs/${name}.jsonl`, [{ id: 'u1', kind: 'user' }])
    }
    const { store, loads } = storeOf({ fs: f.fs, parse: f.parse })
    await store.view('a')
    await store.view('b')
    await store.view('c')
    await store.view('a')
    expect(store.cachedKeys()).toEqual(['b', 'c', 'a'])
    await store.view('d')
    expect(store.cachedKeys()).toEqual(['c', 'a', 'd'])
    await store.event('b', 'u1')
    expect(loads).toEqual(['a', 'b', 'c', 'd', 'b'])
    expect(store.cachedKeys()).toEqual(['a', 'd', 'b'])
  })

  it('shares one in-flight load between open and view, with progress clamped to the file size', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user' }])
    const size = f.files.get('/logs/a.jsonl')!.byteLength
    const { store, loads, gates } = storeOf({ fs: f.fs, parse: f.parse })
    gates.set('a', deferred())
    const handle = await store.open('a', {})
    const seen: LoadProgress[] = []
    handle.onProgress(progress => seen.push(progress))
    const view = store.view('a')
    expect(handle.progress()).toEqual({ bytesRead: 10, totalBytes: size })
    gates.get('a')!.resolve()
    await view
    await handle.done
    expect(loads).toEqual(['a'])
    expect(seen.at(-1)).toEqual({ bytesRead: size, totalBytes: size })
    const again = await store.open('a', {})
    expect(again.cached).toBe(true)
  })

  it('aborts a superseded load and rejects its waiters', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user' }])
    f.write('/logs/b.jsonl', [{ id: 'u1', kind: 'user' }])
    const { store, signals, gates } = storeOf({ fs: f.fs, parse: f.parse })
    gates.set('a', deferred())
    const browser = {}
    const first = await store.open('a', browser)
    const waiting = store.view('a', browser)
    await store.open('b', browser)
    expect(signals.get('a')!.aborted).toBe(true)
    await expect(waiting).rejects.toBeInstanceOf(LoadCancelledError)
    await expect(first.done).rejects.toBeInstanceOf(LoadCancelledError)
    await expect(store.view('b')).resolves.toMatchObject({ traceId: 'b' })
    expect(store.cachedKeys()).toEqual(['b'])
  })

  it('does not abort while another connection still holds the load, and aborts on the last release', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user' }])
    const { store, signals, gates } = storeOf({ fs: f.fs, parse: f.parse })
    gates.set('a', deferred())
    const one = await store.open('a', {})
    const two = await store.open('a', {})
    one.release()
    one.release()
    expect(signals.get('a')!.aborted).toBe(false)
    two.release()
    expect(signals.get('a')!.aborted).toBe(true)
  })

  it('reopening the same trace id from one connection keeps the load running', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user' }])
    const { store, signals, gates } = storeOf({ fs: f.fs, parse: f.parse })
    gates.set('a', deferred())
    const browser = {}
    await store.open('a', browser)
    const second = await store.open('a', browser)
    expect(signals.get('a')!.aborted).toBe(false)
    gates.get('a')!.resolve()
    await second.done
  })

  it('reloads a canonical file once for its originals, and rejects unknown trace ids', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user' }])
    let loads = 0
    const store = new TraceStore({
      resolve: traceId => (traceId === 'a' ? { key: 'a', target: { path: '/logs/a.jsonl' } } : undefined),
      fs: f.fs,
      async load(session) {
        loads += 1
        const trace = f.parse(session.target.path)
        trace.events[0]!.source = { file: 'elsewhere.json', offset: 0, length: 2, line: 1 }
        return { trace, canonical: true }
      },
    })
    const [event, again] = await Promise.all([store.event('a', 'u1'), store.event('a', 'u1')])
    expect(event.original).toEqual({ id: 'u1', kind: 'user' })
    expect(again.original).toEqual({ id: 'u1', kind: 'user' })
    // One load for the trace, one reload shared by the two concurrent calls.
    expect(loads).toBe(2)
    await store.event('a', 'u1')
    // Nothing is kept after a reload settles, so a later call reloads again.
    expect(loads).toBe(3)
    expect(f.reads).toEqual([])
    await expect(store.view('missing')).rejects.toThrow('unknown trace id: missing')
  })

  it('seeds the launch session without copying originals into the cache', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'u1', kind: 'user' }])
    const { store, loads } = storeOf({ fs: f.fs, parse: f.parse })
    const trace = f.parse('/logs/a.jsonl')
    await store.seed({ key: 'a', target: { path: '/logs/a.jsonl' } }, { trace, canonical: false })
    expect(trace.events[0]!.original).toBeDefined()
    const view = await store.view('a')
    expect(view.trace.events[0]).not.toHaveProperty('original')
    expect(loads).toEqual([])
    expect((await store.reconstruct('a', 'u1')).visibleIds).toEqual(['u1'])
  })
  it('withEvents reads source pointers in the order asked', async () => {
    const f = fixture()
    f.write(
      '/logs/a.jsonl',
      Array.from({ length: 100 }, (_, index) => ({ id: `e${index}`, kind: 'user', text: `t${index}` })),
    )
    const { store } = storeOf({ fs: f.fs, parse: f.parse })
    await store.view('a')
    const before = f.reads.length
    const ids = Array.from({ length: 100 }, (_, index) => `e${99 - index}`)
    const events = await store.withEvents('a', read => read(ids))
    expect(events.map(event => event.id)).toEqual(ids)
    expect(f.reads.length - before).toBe(100)
  })

  it('withEvents reloads a canonical file once for all of its reads', async () => {
    const f = fixture()
    f.write(
      '/logs/a.jsonl',
      Array.from({ length: 6 }, (_, index) => ({ id: `e${index}`, kind: 'user' })),
    )
    let loads = 0
    const { store } = storeOf({
      fs: f.fs,
      parse: f.parse,
      load: async session => {
        loads += 1
        return { trace: f.parse(session.target.path), canonical: true }
      },
    })
    await store.view('a')
    const got = await store.withEvents('a', async read => {
      const first = await read(['e0', 'e1', 'e2'])
      const second = await read(['e3', 'e4', 'e5'])
      return [...first, ...second].map(event => (event.original as { id: string }).id)
    })
    expect(got).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5'])
    // One load for the view, one reload for both batches.
    expect(loads).toBe(2)
    await store.event('a', 'e0')
    expect(loads).toBe(3)
  })
})
