import type { ReportInput } from './report.ts'
import { describe, expect, it } from 'vitest'
import { fixture, HOME, present, storeOf } from '../testing/store-fixture.ts'
import { buildReport } from './report.ts'

/** A report of `count` user events; no `present`, so the store serves unredacted text, as with `AGENT_TRACE_REDACT=0`. */
async function reportOf(count: number, text: (index: number) => string, options: Partial<ReportInput> = {}) {
  const f = fixture()
  f.write(
    '/logs/a.jsonl',
    Array.from({ length: count }, (_, index) => ({ id: `e${index}`, kind: 'user', text: text(index) })),
  )
  const { store } = storeOf({ io: f.io, parse: f.parse })
  const view = await store.view('a')
  const report = await store.withEvents('a', read => buildReport({ view, full: read, redact: present, ...options }))
  return { store, report }
}

describe('buildReport', () => {
  it('redacts the view and the full events even when the store does not', async () => {
    const { report } = await reportOf(3, index => `${HOME}/src/file-${index}.ts`, { locale: 'zh-CN' })
    expect(JSON.stringify(report)).not.toContain(HOME)
    expect(report.events.map(event => event.id)).toEqual(['e0', 'e1', 'e2'])
    expect(report.events[0]!.original).toEqual({ id: 'e0', kind: 'user', text: '~/src/file-0.ts' })
    expect(report).toMatchObject({ total: 3, truncated: false, locale: 'zh-CN' })
  })

  it('stops at the event limit', async () => {
    const { report } = await reportOf(12, () => 'x', { maxEvents: 5 })
    expect(report.events.map(event => event.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
    expect(report).toMatchObject({ total: 12, truncated: true })
    expect(report.trace.events).toHaveLength(12)
  })

  it('stops at the byte limit, counting each event in full', async () => {
    const probe = await reportOf(10, () => 'y'.repeat(1000))
    // Offsets differ in digits, so take the largest event as the unit.
    const one = JSON.stringify(await probe.store.event('a', 'e9')).length
    const { report } = await reportOf(10, () => 'y'.repeat(1000), { maxBytes: one * 3 + 2 })
    expect(report.events).toHaveLength(3)
    expect(report.truncated).toBe(true)
  })
})
