import type { EventOf, Trace } from '@rivus/estela-schema'
import { describe, expect, it } from 'vite-plus/test'
import { fixture, redact, storeOf } from '../testing/store-fixture.ts'

describe('TraceStore id lookup', () => {
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

  it('never reads `@e?` as an event, though a recorded id has that text', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: '@e?', kind: 'user', text: 'first' },
      { id: 'second', kind: 'user', text: 'second' },
    ])
    const parse = (file: string): Trace => {
      const [first, second] = f.parse(file).events as EventOf<'user'>[]
      return { ...f.parse(file), events: [first!, { ...second!, parentId: '@e9' }] }
    }
    // `@e?` is what a reference to no event is shown as; it is not the id of the first event, which is shown as `@e0`.
    const missing = { visibleIds: [], unavailable: ['event'], completeness: 'unavailable' }
    for (const read of [{}, { redact }]) {
      const { store } = storeOf({ fs: f.fs, parse, redact })
      const view = await store.view('a')
      expect(view.trace.events.map(event => [event.id, event.parentId])).toEqual([
        ['@e0', undefined],
        ['second', '@e?'],
      ])
      await expect(store.event('a', '@e?', read)).rejects.toThrow('no event @e? in a')
      // A reconstruction of an event that is not there says so, as for any id it cannot find.
      expect(await store.reconstruct('a', '@e?')).toEqual({ eventId: '@e?', ...missing })
      expect(await store.reconstruct('a', '@e9')).toEqual({ eventId: '@e9', ...missing })
      expect((await store.event('a', '@e0', read)).payload).toEqual({ text: 'first' })
    }
  })

  it('does not hand an alias beyond the trace to the kernel as a recorded id', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: '@e99', kind: 'user', text: 'first' },
      { id: 'second', kind: 'user', text: 'second' },
    ])
    const { store } = storeOf({ fs: f.fs, parse: f.parse, redact })
    // The first event is shown as `@e0`; `@e99` is an alias no event has, though a recorded id reads like it.
    await expect(store.event('a', '@e99')).rejects.toThrow('no event @e99 in a')
    expect(await store.reconstruct('a', '@e99')).toEqual({
      eventId: '@e99',
      visibleIds: [],
      unavailable: ['event'],
      completeness: 'unavailable',
    })
    expect((await store.reconstruct('a', '@e0')).visibleIds).toEqual(['@e0'])
  })

  it('treats `@l<n>` and `@l?` as forms it shows, and never reads them as recorded event ids', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: 'first', kind: 'user', text: 'first' },
      { id: '@l?', kind: 'user', text: 'second' },
    ])
    const parse = (file: string): Trace => ({
      ...f.parse(file),
      // A lane whose parent is no lane of the trace.
      agents: [{ id: 'main' }, { id: 'orphan', parentId: '@l88' }],
    })
    const missing = { visibleIds: [], unavailable: ['event'], completeness: 'unavailable' }
    // With redaction off (ESTELA_REDACT=0 on the dev server) a recorded id is read as written, as its view shows it.
    const plain = storeOf({ fs: f.fs, parse }).store
    expect((await plain.view('a')).trace.agents[1]).toEqual({ id: 'orphan', parentId: '@l88' })
    expect((await plain.event('a', '@l?')).seq).toBe(1)
    expect((await plain.reconstruct('a', '@l?')).visibleIds).toEqual(['first', '@l?'])
    // A caller that names its own redaction (the agent tools) resolves by it, though the server shows raw text.
    await expect(plain.event('a', '@l?', { redact })).rejects.toThrow('no event @l? in a')
    expect((await plain.event('a', '@e1', { redact })).seq).toBe(1)
    // With redaction on, `@l?` is what the reference to no lane is shown as, and names no event.
    const { store } = storeOf({ fs: f.fs, parse, redact })
    expect((await store.view('a')).trace.agents[1]).toEqual({ id: 'orphan', parentId: '@l?' })
    for (const read of [{}, { redact }]) {
      await expect(store.event('a', '@l?', read)).rejects.toThrow('no event @l? in a')
      await expect(store.event('a', '@l1', read)).rejects.toThrow('no event @l1 in a')
    }
    expect(await store.reconstruct('a', '@l?')).toEqual({ eventId: '@l?', ...missing })
    expect(await store.reconstruct('a', '@l1')).toEqual({ eventId: '@l1', ...missing })
    // The event whose recorded id reads like that is still reached by the id its view shows.
    expect((await store.event('a', '@e1')).seq).toBe(1)
  })
})
