import { describe, expect, it } from 'vitest'
import { fixture, HOME, present, storeOf } from '../testing/store-fixture.ts'
import { buildReport } from './report.ts'

function session(count: number, text: (index: number) => string) {
  const f = fixture()
  f.write('/logs/a.jsonl', Array.from({ length: count }, (_, index) => ({ id: `e${index}`, kind: 'user', text: text(index) })))
  // No `present`: the store serves unredacted text, as with `AGENT_TRACE_REDACT=0`.
  return { f, ...storeOf({ io: f.io, parse: f.parse }) }
}

describe('buildReport', () => {
  it('redacts the view and the full events even when the store does not', async () => {
    const { store } = session(3, index => `${HOME}/src/file-${index}.ts`)
    const report = await buildReport({ view: await store.view('a'), full: ids => store.events('a', ids), redact: present, locale: 'zh-CN' })
    expect(JSON.stringify(report)).not.toContain(HOME)
    expect(report.events.map(event => event.id)).toEqual(['e0', 'e1', 'e2'])
    expect(report.events[0]!.original).toEqual({ id: 'e0', kind: 'user', text: '~/src/file-0.ts' })
    expect(report).toMatchObject({ total: 3, truncated: false, locale: 'zh-CN' })
  })

  it('stops at the event limit', async () => {
    const { store } = session(12, () => 'x')
    const report = await buildReport({ view: await store.view('a'), full: ids => store.events('a', ids), redact: present, maxEvents: 5 })
    expect(report.events.map(event => event.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
    expect(report).toMatchObject({ total: 12, truncated: true, limits: { events: 5 } })
    expect(report.trace.events).toHaveLength(12)
  })

  it('stops at the byte limit, counting each event in full', async () => {
    const { store } = session(10, () => 'y'.repeat(1000))
    // Offsets differ in digits, so take the largest event as the unit.
    const one = JSON.stringify(await store.event('a', 'e9')).length
    const report = await buildReport({ view: await store.view('a'), full: ids => store.events('a', ids), redact: present, maxBytes: one * 3 + 2 })
    expect(report.events).toHaveLength(3)
    expect(report.eventBytes).toBeLessThanOrEqual(one * 3 + 2)
    expect(report.truncated).toBe(true)
  })

  it('reads source pointers a few at a time and keeps the order', async () => {
    const { f, store } = session(100, index => `t${index}`)
    await store.view('a')
    const before = f.reads.length
    const events = await store.events('a', Array.from({ length: 100 }, (_, index) => `e${99 - index}`))
    expect(events.map(event => event.id)).toEqual(Array.from({ length: 100 }, (_, index) => `e${99 - index}`))
    expect(f.reads.length - before).toBe(100)
  })
})
