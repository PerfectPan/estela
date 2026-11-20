import type { ReconstructResult, Trace, TraceEvent } from '@rivus/estela-schema'
import { describe, expect, it } from 'vite-plus/test'
import { jsonChars, RESULT_CHARS } from './bounds.ts'
import { eventResult, surfaceResult } from './event-read.ts'
import { TraceIds } from './trace-ids.ts'

function userEvent(id: string, text: string, seq = 0): TraceEvent {
  return {
    id,
    seq,
    ts: 1,
    kind: 'user',
    payload: { text },
    source: { file: '/h/log.jsonl', offset: 0, length: 1, line: 1 },
  }
}

function traceOf(events: TraceEvent[]): Trace {
  return { schema: 'estela', agent: 'test', session: { id: 's' }, capabilities: [], agents: [], events, skipped: [] }
}

const same = <T>(value: T): T => value
const homeToTilde = <T>(value: T): T => JSON.parse(JSON.stringify(value).replaceAll('/h', '~'))
const plain = { value: same, text: (text: string) => text }
const tilde = {
  value: homeToTilde,
  text: (text: string) => text.replaceAll('/h', '~'),
}

describe('eventResult', () => {
  it('redacts before cutting and lists the cut paths', () => {
    const event = userEvent('u1', `/h/a ${'x'.repeat(400)}`)
    const trace = traceOf([event])
    const result = eventResult(
      trace,
      't',
      event,
      new TraceIds(trace, () => true),
      { maxChars: 256, original: false },
      tilde,
    )
    expect(result.event.payload).toEqual({ text: `~/a ${'x'.repeat(252)}` })
    expect(result.event.truncated).toEqual([['payload', 'text']])
    expect(result.event.source).toEqual({ file: '~/log.jsonl', line: 1 })
  })

  it('lowers the cap, then leaves out the original, to stay under the size bound', () => {
    const many = Array.from({ length: 400 }, () => 'z'.repeat(300))
    const event: TraceEvent = { ...userEvent('u1', 'short'), original: { many } }
    const trace = traceOf([event])
    const ids = new TraceIds(trace, () => true)
    const result = eventResult(trace, 't', event, ids, { maxChars: 20_000, original: true }, plain)
    expect(result.maxChars).toBe(256)
    expect(result.event.omitted).toEqual(['original'])
    expect(result.event.payload).toEqual({ text: 'short' })
    expect(jsonChars(result)).toBeLessThanOrEqual(RESULT_CHARS)
  })

  it('leaves out only the parts it holds', () => {
    const many = Array.from({ length: 400 }, () => 'z'.repeat(300))
    const event: TraceEvent = { ...userEvent('u1', 'short'), kind: 'user', payload: { text: 'short', many } }
    const trace = traceOf([event])
    const result = eventResult(
      trace,
      't',
      event,
      new TraceIds(trace, () => true),
      { maxChars: 2000, original: false },
      plain,
    )
    expect(result.event.omitted).toEqual(['payload'])
    expect(jsonChars(result)).toBeLessThanOrEqual(RESULT_CHARS)
  })
})

describe('surfaceResult', () => {
  it('keeps the last ids of each list, with counts', () => {
    const events = Array.from({ length: 150 }, (_, index) => userEvent(`e${index}`, '', index))
    const visibleIds = events.map(event => event.id)
    const surface: ReconstructResult = {
      eventId: 'e149',
      visibleIds,
      unavailable: [],
      completeness: 'full',
      slots: [{ name: 'messages', status: 'present', eventIds: visibleIds }],
      tokens: [],
      removedIds: [],
    }
    const trace = traceOf(events)
    const result = surfaceResult('t', surface, new TraceIds(trace, () => true), plain)
    expect(result.visibleIds).toEqual(visibleIds.slice(50))
    expect(result.visibleCount).toBe(150)
    expect(result.slots[0]).toMatchObject({ eventCount: 150 })
    expect(result.truncated).toEqual([['slots', 0, 'eventIds'], ['visibleIds']])
  })
})
