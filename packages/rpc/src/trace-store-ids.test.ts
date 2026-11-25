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
    for (const read of [{}, { redact }]) {
      const { store } = storeOf({ fs: f.fs, parse, redact })
      const view = await store.view('a')
      expect(view.trace.events.map(event => [event.id, event.parentId])).toEqual([
        ['@e0', undefined],
        ['second', '@e?'],
      ])
      await expect(store.event('a', '@e?', read)).rejects.toThrow('no event @e? in a')
      await expect(store.reconstruct('a', '@e?')).rejects.toThrow('no event @e? in a')
      // An alias beyond the trace is any other missing id: the kernel says it could not find the event.
      expect((await store.reconstruct('a', '@e9')).unavailable).toContain('event')
      expect((await store.event('a', '@e0', read)).payload).toEqual({ text: 'first' })
    }
  })
})
