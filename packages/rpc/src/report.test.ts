import type { EventOf, Trace } from '@rivus/estela-schema'
import type { ReportInput } from './report.ts'
import { cloneDeepWith } from 'es-toolkit/object'
import { describe, expect, it } from 'vite-plus/test'
import { fixture, HOME, redact, storeOf } from '../testing/store-fixture.ts'
import { loadedReport } from './report.ts'
import { TraceStore } from './trace-store.ts'

/** A report of the session `a` as the store has it loaded, with the fixture's redaction unless `options` names one. */
const reportOf = (store: TraceStore, options: Partial<ReportInput> = {}) =>
  loadedReport(store, 'a', { redact, ...options })

/** A report of `count` user events; no `redact`, so the store serves unredacted text, as with `ESTELA_REDACT=0`. */
async function plainReport(count: number, text: (index: number) => string, options: Partial<ReportInput> = {}) {
  const f = fixture()
  f.write(
    '/logs/a.jsonl',
    Array.from({ length: count }, (_, index) => ({ id: `e${index}`, kind: 'user', text: text(index) })),
  )
  const { store } = storeOf({ fs: f.fs, parse: f.parse })
  const report = await reportOf(store, options)
  return { store, report }
}

describe('buildReport', () => {
  it('redacts the view and the full events even when the store does not', async () => {
    const { report } = await plainReport(3, index => `${HOME}/src/file-${index}.ts`, { locale: 'zh-CN' })
    expect(JSON.stringify(report)).not.toContain(HOME)
    expect(report.events.map(event => event.id)).toEqual(['e0', 'e1', 'e2'])
    expect(report.events[0]!.original).toEqual({ id: 'e0', kind: 'user', text: '~/src/file-0.ts' })
    expect(report).toMatchObject({ total: 3, truncated: false, locale: 'zh-CN' })
  })

  it('gives an id its own alias, whether or not the server redacted, and holds every event the view names', async () => {
    const f = fixture()
    f.write('/logs/a.jsonl', [
      { id: 'e0', kind: 'user', text: 'first' },
      { id: `${HOME}/ids/e1`, kind: 'user', text: 'second' },
    ])
    for (const server of [undefined, redact]) {
      const { store } = storeOf({ fs: f.fs, parse: f.parse, ...(server ? { redact: server } : {}) })
      const report = await reportOf(store)
      // Each event keeps its own original, and the view names it by the report's alias.
      expect(report.trace.events.map(event => event.id)).toEqual(['e0', '@e1'])
      expect(report.events.map(event => [event.id, event.payload.text])).toEqual([
        ['e0', 'first'],
        ['@e1', 'second'],
      ])
      expect(report.events[1]!.original).toEqual({ id: '~/ids/e1', kind: 'user', text: 'second' })
      expect(JSON.stringify(report)).not.toContain(HOME)
    }
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
      const report = await loadedReport(store, 'a', { redact: both })
      expect(report.events.map(event => [event.id, event.payload, event.original])).toEqual([
        ['@e0', { text: 'first' }, { id: '~/evt', kind: 'user', text: 'first' }],
        ['@e1', { text: 'second' }, { id: '~/evt', kind: 'user', text: 'second' }],
      ])
      expect(report.trace.events.map(event => event.id)).toEqual(['@e0', '@e1'])
      expect(JSON.stringify(report)).not.toContain(HOME)
      expect(JSON.stringify(report)).not.toContain(other)
    }
  })

  it('names the event a reference cuts short in the view points at, as the full event does', async () => {
    const f = fixture()
    // Longer than the view's cap, and under the home: the view cuts it, redaction would change it.
    const summary = `${HOME}/ids/${'s'.repeat(4100)}`
    f.write('/logs/a.jsonl', [
      { id: 'e0', kind: 'user', text: 'before' },
      { id: 'compact', kind: 'user' },
      { id: summary, kind: 'user', text: 'the summary' },
    ])
    const parse = (file: string): Trace => {
      const [before, compaction, summaryEvent] = f.parse(file).events as EventOf<'user'>[]
      return {
        ...f.parse(file),
        events: [before!, { ...compaction!, kind: 'compaction', payload: { summaryEventId: summary } }, summaryEvent!],
      }
    }
    // The server with ESTELA_REDACT=0 shows the reference cut; the report's view and its full event agree.
    const { store } = storeOf({ fs: f.fs, parse })
    const report = await reportOf(store)
    expect(report.trace.events[2]!.id).toBe('@e2')
    expect(report.trace.events[1]!.payload).toEqual({ summaryEventId: '@e2' })
    expect(report.events[1]!.payload).toEqual({ summaryEventId: '@e2' })
    expect(JSON.stringify(report)).not.toContain(HOME)
  })

  it('builds its view and reads its events from one loaded trace, whatever else is loaded meanwhile', async () => {
    const f = fixture()
    const snapshot = [
      { id: 'e0', kind: 'user', text: 'first' },
      { id: `${HOME}/ids/e1`, kind: 'user', text: 'second' },
    ]
    f.write('/logs/a.jsonl', snapshot)
    const others = ['b', 'c', 'd']
    for (const name of others) {
      f.write(`/logs/${name}.jsonl`, [{ id: 'u1', kind: 'user', text: name }])
    }
    let store!: TraceStore
    let looks = 0
    // A look at the session beyond the two a report makes finds the log replaced and the cache full of other
    // sessions, so a view or a read that took the session again would see another snapshot. The report must not.
    const seeded = storeOf({
      fs: f.fs,
      parse: f.parse,
      resolve: traceId => {
        if (traceId === 'a' && ++looks === 3) {
          f.write('/logs/a.jsonl', [
            { id: 'e0', kind: 'user', text: 'fresh first' },
            { id: `${HOME}/ids/e1`, kind: 'user', text: 'fresh second' },
            { id: 'e2', kind: 'user', text: 'fresh third' },
          ])
          for (const name of others) {
            const path = `/logs/${name}.jsonl`
            void store.seed({ key: name, target: { path } }, { trace: f.parse(path), canonical: true })
          }
        }
        return { key: traceId, target: { path: `/logs/${traceId}.jsonl` } }
      },
    })
    store = seeded.store
    await store.view('a')
    // The report is the snapshot the read started from: two events, each with the text its view shows.
    const report = await reportOf(store)
    expect(report).toMatchObject({ total: 2, truncated: false })
    expect(report.trace.events.map(event => [event.id, event.payload.text])).toEqual([
      ['e0', 'first'],
      ['@e1', 'second'],
    ])
    expect(report.events.map(event => [event.id, event.payload.text])).toEqual([
      ['e0', 'first'],
      ['@e1', 'second'],
    ])
    // The session was looked at once to load it and once to read it: no view or read took it again.
    expect(looks).toBe(2)
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
    const report = await reportOf(store)
    expect(report.events.map(event => event.id)).toEqual(['e0', '@e1'])
    expect(report.events[1]!.original).toEqual({ id: '~/ids/e1', kind: 'user', text: 'second' })
    expect(JSON.stringify(report)).not.toContain(HOME)
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
    await expect(reportOf(store)).rejects.toThrow(`cannot reread ~/logs/a.jsonl`)
  })

  it('stops at the event limit', async () => {
    const { report } = await plainReport(12, () => 'x', { maxEvents: 5 })
    expect(report.events.map(event => event.id)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4'])
    expect(report).toMatchObject({ total: 12, truncated: true })
    expect(report.trace.events).toHaveLength(12)
  })

  it('stops at the byte limit, counting each event in full', async () => {
    const probe = await plainReport(10, () => 'y'.repeat(1000))
    // Offsets differ in digits, so take the largest event as the unit.
    const one = JSON.stringify(probe.report.events[9]).length
    const { report } = await plainReport(10, () => 'y'.repeat(1000), { maxBytes: one * 3 + 2 })
    expect(report.events).toHaveLength(3)
    expect(report.truncated).toBe(true)
  })
})
