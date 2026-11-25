import type { Trace } from '@rivus/estela-schema'
import type { ReportInput } from './report.ts'
import { cloneDeepWith } from 'es-toolkit/object'
import { describe, expect, it } from 'vite-plus/test'
import { fixture, HOME, redact, storeOf } from '../testing/store-fixture.ts'
import { buildReport } from './report.ts'
import { TraceStore } from './trace-store.ts'

/** A report of `count` user events; no `redact`, so the store serves unredacted text, as with `ESTELA_REDACT=0`. */
async function reportOf(count: number, text: (index: number) => string, options: Partial<ReportInput> = {}) {
  const f = fixture()
  f.write(
    '/logs/a.jsonl',
    Array.from({ length: count }, (_, index) => ({ id: `e${index}`, kind: 'user', text: text(index) })),
  )
  const { store } = storeOf({ fs: f.fs, parse: f.parse })
  const view = await store.view('a')
  const report = await store.withEvents('a', read => buildReport({ view, full: read, redact, ...options }))
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

  it('holds every event whose id the view shows, also when the store redacts ids into aliases', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: 'e0', kind: 'user', text: 'first' },
      { id: `${HOME}/ids/e1`, kind: 'user', text: 'second' },
    ])
    // The report is built from the view's ids, which the store shows as aliases.
    const { store } = storeOf({ fs: f.fs, parse: f.parse, redact })
    const view = await store.view('a')
    expect(view.trace.events.map(event => event.id)).toEqual(['e0', '@e1'])
    const report = await store.withEvents('a', read => buildReport({ view, full: read, redact }))
    expect(report.events.map(event => event.id)).toEqual(['e0', '@e1'])
    expect(report.events[1]!.original).toEqual({ id: '~/ids/e1', kind: 'user', text: 'second' })
    expect(JSON.stringify(report)).not.toContain(HOME)
  })

  it('holds every event the view names when only the report redacts, as with ESTELA_REDACT=0 and "Export report"', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: 'e0', kind: 'user', text: 'first' },
      { id: `${HOME}/ids/e1`, kind: 'user', text: 'second' },
    ])
    // The view shows the recorded id; the report gives it the alias of its own redaction, in the view and the event alike.
    const { store } = storeOf({ fs: f.fs, parse: f.parse })
    const view = await store.view('a')
    const report = await store.withEvents('a', read => buildReport({ view, full: read, redact }))
    expect(view.trace.events.map(event => event.id)).toEqual(['e0', `${HOME}/ids/e1`])
    expect(report.events.map(event => event.id)).toEqual(['e0', '@e1'])
    expect(report.trace.events.map(event => event.id)).toEqual(report.events.map(event => event.id))
    expect(report.events[1]!.original).toEqual({ id: '~/ids/e1', kind: 'user', text: 'second' })
    expect(JSON.stringify(report)).not.toContain(HOME)
  })

  it('shows the same ids in a report of a compressed log, whose records are read back through a reload', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: 'e0', kind: 'user', text: 'first' },
      { id: `${HOME}/ids/e1`, kind: 'user', text: 'second' },
    ])
    // A `codec` on each source pointer is what makes a read go through the reloaded file.
    const parse = (file: string): Trace => {
      const trace = f.parse(file)
      for (const event of trace.events) {
        event.source = { ...event.source, codec: 'zstd' }
      }
      return trace
    }
    const { store } = storeOf({ fs: f.fs, parse, redact })
    const view = await store.view('a')
    const report = await store.withEvents('a', read => buildReport({ view, full: read, redact }))
    expect(view.trace.events.map(event => event.id)).toEqual(['e0', '@e1'])
    expect(report.events.map(event => event.id)).toEqual(['e0', '@e1'])
    expect(report.events[1]!.original).toEqual({ id: '~/ids/e1', kind: 'user', text: 'second' })
    expect(JSON.stringify(report)).not.toContain(HOME)
  })

  it('gives two ids that redact to the same text two aliases, whether or not the server redacts', async () => {
    const f = fixture()
    const other = '/srv/agents'
    const hide = (text: string): string => text.replaceAll(HOME, '~').replaceAll(other, '~')
    const both = {
      value: <T>(value: T): T => cloneDeepWith(value, item => (typeof item === 'string' ? hide(item) : undefined)),
      text: hide,
    }
    f.write('/logs/a.jsonl', [
      { id: `${HOME}/evt`, kind: 'user', text: 'first' },
      { id: `${other}/evt`, kind: 'user', text: 'second' },
    ])
    // Left out: the server with ESTELA_REDACT=0. Given: the server redacting one home, the report both.
    for (const server of [undefined, redact]) {
      const { store } = storeOf({ fs: f.fs, parse: f.parse, ...(server ? { redact: server } : {}) })
      const view = await store.view('a')
      expect(view.trace.events.map(event => event.id)).toEqual(
        server ? ['@e0', '@e1'] : [`${HOME}/evt`, `${other}/evt`],
      )
      const report = await store.withEvents('a', read => buildReport({ view, full: read, redact: both }))
      // Each event keeps its own original: read by the id the view gave, shown by the report's.
      expect(report.events.map(event => [event.id, event.payload, event.original])).toEqual([
        ['@e0', { text: 'first' }, { id: '~/evt', kind: 'user', text: 'first' }],
        ['@e1', { text: 'second' }, { id: '~/evt', kind: 'user', text: 'second' }],
      ])
      expect(report.trace.events.map(event => event.id)).toEqual(['@e0', '@e1'])
      expect(JSON.stringify(report)).not.toContain(HOME)
      expect(JSON.stringify(report)).not.toContain(other)
    }
  })

  it('leaves a failed read redacted, as get-event does', async () => {
    const f = fixture()
    const file = `${HOME}/logs/a.jsonl`
    f.write(file, [{ id: 'e0', kind: 'user', text: 'x' }])
    let loads = 0
    const store = new TraceStore({
      resolve: traceId => ({ key: traceId, target: { path: file } }),
      fs: f.fs,
      redact,
      async load(session) {
        loads += 1
        // A canonical file is read again for its originals; that second read fails.
        if (loads > 1) {
          throw new Error(`cannot reread ${session.target.path}`)
        }
        return { trace: f.parse(session.target.path), canonical: true }
      },
    })
    await store.view('a')
    await expect(store.withEvents('a', read => read(['e0']))).rejects.toThrow(`cannot reread ~/logs/a.jsonl`)
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
