import type { EventOf, Trace } from '@rivus/estela-schema'
import type { LoadProgress } from './trace-store.ts'
import { describe, expect, it, vi } from 'vite-plus/test'
import { deferred, fixture, HOME, redact, recordOf, storeOf } from '../testing/store-fixture.ts'
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
    const { store } = storeOf({ fs: f.fs, parse: f.parse, redact, maxString: 256 })
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

  it('presents reconstruct like get-event, and withTrace hands over the trace without originals', async () => {
    const f = fixture()
    const id = `${HOME}/u1`
    f.write('/logs/a.jsonl', [{ id, kind: 'user', text: 'hi' }])
    const { store } = storeOf({ fs: f.fs, parse: f.parse, redact })
    const surface = await store.reconstruct('a', '@e0')
    expect(surface).toMatchObject({ eventId: '@e0', visibleIds: ['@e0'] })
    // The recorded id still names the event.
    expect(await store.reconstruct('a', id)).toEqual(surface)
    expect(JSON.stringify(surface)).not.toContain(HOME)
    const events = await store.withTrace('a', trace => trace.events)
    expect(events.map(event => event.id)).toEqual([id])
    expect(events[0]).not.toHaveProperty('original')
    await expect(store.withTrace('missing', trace => trace)).rejects.toThrow('unknown trace id: missing')
  })

  it('shows an id the redaction would change as an alias, in every reference to it, and takes the alias back', async () => {
    const f = fixture()
    const lane = `${HOME}/agents/sub`
    const child = `${HOME}/ids/child`
    f.write('/logs/a.jsonl', [
      { id: 'spawn', kind: 'user', text: 'start' },
      { id: child, kind: 'user', text: 'found' },
      { id: 'note', kind: 'user', text: 'kept' },
      { id: 'summary', kind: 'user', text: 'summed up' },
      { id: 'end', kind: 'user', text: 'after' },
    ])
    const parse = (file: string): Trace => {
      const trace = f.parse(file)
      const [spawn, found, note, summary, end] = trace.events as EventOf<'user'>[]
      return {
        ...trace,
        agents: [{ id: 'main' }, { id: lane, parentId: 'main' }, { id: 'orphan', parentId: 'gone lane' }],
        events: [
          spawn!,
          { ...found!, agentId: lane, parentId: 'spawn' },
          { ...note!, parentId: `${HOME}/records/gone`, shadowedBy: 'summary' },
          { ...summary!, kind: 'compaction', payload: { summaryEventId: child } },
          end!,
        ],
      }
    }
    const { store } = storeOf({ fs: f.fs, parse, redact })
    const { trace } = await store.view('a')
    // Safe ids stay; one redaction changes is `@e<seq>` wherever it appears, in events and lanes alike.
    // A lane whose parent is no lane of this trace keeps the reference for the text redaction.
    expect(trace.agents).toEqual([
      { id: 'main' },
      { id: '@l1', parentId: 'main' },
      { id: 'orphan', parentId: 'gone lane' },
    ])
    expect(trace.events.map(event => [event.id, event.agentId, event.parentId, event.shadowedBy])).toEqual([
      ['spawn', undefined, undefined, undefined],
      ['@e1', '@l1', 'spawn', undefined],
      ['note', undefined, '~/records/gone', 'summary'],
      ['summary', undefined, undefined, undefined],
      ['end', undefined, undefined, undefined],
    ])
    expect(trace.events[3]!.payload).toEqual({ summaryEventId: '@e1' })

    const event = await store.event('a', '@e1')
    expect(event).toMatchObject({ id: '@e1', agentId: '@l1', parentId: 'spawn', payload: { text: 'found' } })
    expect(event.original).toEqual({ id: '~/ids/child', kind: 'user', text: 'found' })
    // The original is redacted as text: its `id` names the home, which is hidden.
    expect(JSON.stringify(event)).not.toContain(HOME)
    expect((await store.event('a', child)).id).toBe('@e1')
    await expect(store.event('a', '~/ids/child')).rejects.toThrow('no event ~/ids/child')
    // What a compaction removed is named by its shown id.
    expect((await store.reconstruct('a', 'end')).removedIds).toEqual(['note'])
    // What `build` does: events with their originals from the trace it loaded itself, shown as `get-event` shows them.
    const loaded = parse('/logs/a.jsonl')
    const indexing = vi.spyOn(loaded.events, 'map')
    const [found, safe] = store.presented(loaded, ['@e1', 'spawn'])
    expect(found).toMatchObject({ id: '@e1', agentId: '@l1', parentId: 'spawn', original: { id: '~/ids/child' } })
    expect(safe!.id).toBe('spawn')
    expect(() => store.presented(loaded, ['@e9'])).toThrow('no event @e9')
    expect(() => store.presented(loaded, ['gone'])).toThrow('no event gone')
    // Indexed once for the trace, however many batches ask: `build` reads 250 events at a time.
    expect(indexing).toHaveBeenCalledTimes(1)
    for (let batch = 0; batch < 8; batch++) {
      store.presented(loaded, ['spawn'])
    }
    expect(indexing).toHaveBeenCalledTimes(1)
  })

  it('resolves an id once, so a recorded id that merely looks like an alias names its own event', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: '@e1', kind: 'user', text: 'first' },
      { id: 'blue', kind: 'user', text: 'second' },
    ])
    // The server shows the browser unredacted text, as with ESTELA_REDACT=0; a caller that always redacts names
    // its own rule, and gets the event shown with it.
    const { store } = storeOf({ fs: f.fs, parse: f.parse })
    expect((await store.view('a')).trace.events.map(event => event.id)).toEqual(['@e1', 'blue'])
    const first = await store.event('a', '@e0', { redact })
    expect(first).toMatchObject({ id: '@e0', seq: 0, payload: { text: 'first' }, original: { id: '@e1' } })
    expect((await store.event('a', 'blue', { redact })).payload).toEqual({ text: 'second' })
    await expect(store.event('a', '@e0')).rejects.toThrow('no event @e0')
    // With the store's own redaction, the view's id and the event's are one resolution too.
    const shown = storeOf({ fs: f.fs, parse: f.parse, redact })
    const [alias] = (await shown.store.view('a')).trace.events.map(event => event.id)
    expect([alias, (await shown.store.event('a', alias!)).seq]).toEqual(['@e0', 0])
  })

  it('never shows a reference to no event under a form that reads as an alias of one', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: 'first', kind: 'user', text: 'kept' },
      { id: `${HOME}/ids/compaction`, kind: 'user', text: 'summary' },
      { id: 'laneless', kind: 'user' },
    ])
    const parse = (file: string): Trace => {
      const [first, compaction, other] = f.parse(file).events as EventOf<'user'>[]
      return {
        ...f.parse(file),
        agents: [{ id: 'main' }, { id: 'orphan', parentId: '@l7' }],
        // The log points at `@e1`, which no recorded id equals; the compaction below is shown as `@e1`.
        events: [
          { ...first!, shadowedBy: '@e1' },
          { ...compaction!, kind: 'compaction', payload: {} },
          { ...other!, parentId: '@e9' },
        ],
      }
    }
    const { store } = storeOf({ fs: f.fs, parse, redact })
    const { trace } = await store.view('a')
    expect(trace.agents[1]).toEqual({ id: 'orphan', parentId: '@l?' })
    expect(trace.events.map(event => [event.id, event.shadowedBy, event.parentId])).toEqual([
      ['first', '@e?', undefined],
      ['@e1', undefined, undefined],
      ['laneless', undefined, '@e?'],
    ])
    // The alias still names the compaction alone.
    expect((await store.event('a', '@e1')).payload).toEqual({})
  })

  it('sends ids as recorded, and looks them up as recorded, without a redaction', async () => {
    const f = fixture()
    const id = `${HOME}/ids/u1`
    f.write('/logs/a.jsonl', [{ id, kind: 'user', text: 'hi' }])
    const { store } = storeOf({ fs: f.fs, parse: f.parse })
    expect((await store.view('a')).trace.events[0]!.id).toBe(id)
    expect((await store.event('a', id)).id).toBe(id)
    await expect(store.event('a', '@e0')).rejects.toThrow('no event @e0')
    expect(store.presented(f.parse('/logs/a.jsonl'), [id])[0]!.id).toBe(id)
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
      return [...first, ...second].map(event => recordOf(event.original).id)
    })
    expect(got).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5'])
    // One load for the view, one reload for both batches.
    expect(loads).toBe(2)
    await store.event('a', 'e0')
    expect(loads).toBe(3)
  })

  it('withEvents decompresses a compressed log once for all of its reads', async () => {
    const f = fixture()
    f.write(
      '/logs/a.jsonl',
      Array.from({ length: 6 }, (_, index) => ({ id: `e${index}`, kind: 'user' })),
    )
    let loads = 0
    let reads = 0
    const { store } = storeOf({
      fs: f.fs,
      parse: f.parse,
      load: async () => {
        loads += 1
        const trace = f.parse('/logs/a.jsonl')
        for (const event of trace.events) {
          event.source = { ...event.source, codec: 'zstd' }
        }
        return { trace, canonical: false }
      },
      readOriginal: async () => {
        reads += 1
        return { from: 'reader' }
      },
    })
    await store.view('a')
    const got = await store.withEvents('a', async read => {
      const first = await read(['e0', 'e1', 'e2'])
      const second = await read(['e3', 'e4', 'e5'])
      return [...first, ...second].map(event => recordOf(event.original).id)
    })
    expect(got).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5'])
    // One load for the view and one decompression (a reload) for both batches, not one per event.
    expect(loads).toBe(2)
    expect(reads).toBe(0)
    // A single get-event still reads through the platform reader.
    await store.event('a', 'e0')
    expect(reads).toBe(1)
  })

  it('withEvents reports a compressed record that changed since the load', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: 'e0', kind: 'user', text: 'AAAA', data: { content: 'first' } },
      { id: 'e1', kind: 'user', text: 'BBBB', data: { content: 'second' } },
    ])
    const { store } = storeOf({
      fs: f.fs,
      parse: f.parse,
      load: async () => {
        const trace = f.parse('/logs/a.jsonl')
        for (const event of trace.events) {
          event.source = { ...event.source, codec: 'zstd' }
        }
        return { trace, canonical: false }
      },
    })
    await store.view('a')
    // Same length, different nested record: the compressed line is fingerprinted whole, so this counts.
    const bytes = f.files.get('/logs/a.jsonl')!
    const text = new TextDecoder().decode(bytes).replace('"content":"second"', '"content":"changed"')
    f.files.set('/logs/a.jsonl', new TextEncoder().encode(text))
    const got = await store.withEvents('a', read => read(['e0', 'e1']))
    expect(got[0]!.original).toBeDefined()
    expect(got[1]!.originalUnavailable).toContain('holds a different record')
  })

  it('does not decompress for a withEvents call that reads nothing', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'e0', kind: 'user' }])
    let loads = 0
    const { store } = storeOf({
      fs: f.fs,
      parse: f.parse,
      load: async () => {
        loads += 1
        const trace = f.parse('/logs/a.jsonl')
        for (const event of trace.events) {
          event.source = { ...event.source, codec: 'zstd' }
        }
        return { trace, canonical: false }
      },
    })
    await store.view('a')
    await expect(store.withEvents('a', async () => 42)).resolves.toBe(42)
    expect(loads).toBe(1)
  })

  it('falls back to source-pointer reads when the compressed reload fails', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [{ id: 'e0', kind: 'user', text: 'AAAA' }])
    let loads = 0
    let reads = 0
    const record = { id: 'e0', kind: 'user', text: 'AAAA' }
    const { store } = storeOf({
      fs: f.fs,
      parse: f.parse,
      load: async () => {
        loads += 1
        if (loads > 1) {
          throw new Error('reload failed')
        }
        const trace = f.parse('/logs/a.jsonl')
        for (const event of trace.events) {
          event.source = { ...event.source, codec: 'zstd' }
        }
        return { trace, canonical: false }
      },
      readOriginal: async () => {
        reads += 1
        return record
      },
    })
    await store.view('a')
    // The reload fails, so the batch reads the pointer instead of failing the whole report.
    const got = await store.withEvents('a', read => read(['e0']))
    expect(got[0]!.original).toEqual(record)
    expect(reads).toBe(1)
    expect(loads).toBe(2)
  })
})
