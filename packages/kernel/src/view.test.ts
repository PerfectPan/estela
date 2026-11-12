import type { Trace, TraceEventPayloads } from '@rivus/estela-schema'
import { describe, expect, it } from 'vite-plus/test'
import { capStrings, fitView, toView } from './view.ts'

/** One `user` event: its payload declares no required field, so any keys can stand in for a recorded payload. */
function traceOf(payload: TraceEventPayloads['user'], session: Trace['session'] = { id: 's' }): Trace {
  return {
    schema: 'estela',
    agent: 'demo',
    session,
    capabilities: [],
    agents: [],
    skipped: [],
    events: [
      {
        id: 'e',
        seq: 0,
        ts: 0,
        kind: 'user',
        payload,
        source: { file: 'fixture.json', offset: 0, length: 1, line: 1 },
        original: { secret: 'keep-me-out' },
      },
    ],
  }
}

describe('toView', () => {
  it('drops original and caps long strings', () => {
    const trace = traceOf({ text: 'x'.repeat(300) })
    const view = toView(trace, { maxString: 256 })
    expect(view.events[0]?.original).toBeUndefined()
    expect('original' in view.events[0]!).toBe(false)
    expect(view.events[0]?.payload.text).toBe('x'.repeat(256))
    expect(view.events[0]?.payload.$truncated).toEqual([['text']])
    expect(view.view).toEqual({ maxString: 256 })
    expect(trace.events[0]?.original).toEqual({ secret: 'keep-me-out' })
  })

  it('defaults to 4,096 characters and records nested and array paths', () => {
    const long = 'y'.repeat(5000)
    const view = toView(
      traceOf({
        callId: 'c1',
        output: { stdout: long, lines: ['short', long], exact: 'z'.repeat(4096) },
        count: 3,
      }),
    )
    const payload = view.events[0]!.payload
    expect(payload.output).toEqual({
      stdout: 'y'.repeat(4096),
      lines: ['short', 'y'.repeat(4096)],
      exact: 'z'.repeat(4096),
    })
    expect(payload.count).toBe(3)
    expect(payload.callId).toBe('c1')
    expect(payload.$truncated).toEqual([
      ['output', 'stdout'],
      ['output', 'lines', 1],
    ])
  })

  it('leaves events with no long string unmarked', () => {
    const view = toView(traceOf({ text: 'short' }))
    expect(view.events[0]?.payload).toEqual({ text: 'short' })
  })

  it('caps session strings and marks them on the session', () => {
    const view = toView(
      traceOf({}, { id: 's', systemPrompt: 'p'.repeat(300), tools: [{ description: 'd'.repeat(300) }] }),
      { maxString: 256 },
    )
    expect(view.session.systemPrompt).toBe('p'.repeat(256))
    expect(view.session.$truncated).toEqual([['systemPrompt'], ['tools', 0, 'description']])
  })

  it('does not mutate the input, and replaces a stale marker', () => {
    const trace = traceOf({ text: 'x'.repeat(300), $truncated: [['stale']] })
    const before = structuredClone(trace)
    const view = toView(trace, { maxString: 256 })
    expect(trace).toEqual(before)
    expect(view.events[0]?.payload.$truncated).toEqual([['text']])
    expect(view.events[0]).not.toBe(trace.events[0])
  })

  it('interns source files and keeps record identity', () => {
    const trace = traceOf({ text: 'a' })
    trace.events.push(
      {
        ...trace.events[0]!,
        id: 'f',
        seq: 1,
        source: { file: '/logs/sub/agent-a.jsonl', offset: 5, length: 2, line: 3 },
      },
      { ...trace.events[0]!, id: 'g', seq: 2 },
    )
    const view = toView(trace)
    expect(view.sourceFiles).toEqual(['fixture.json', '/logs/sub/agent-a.jsonl'])
    expect(view.events.map(event => event.source)).toEqual([
      { file: '0', offset: 0, length: 1, line: 1 },
      { file: '1', offset: 5, length: 2, line: 3 },
      { file: '0', offset: 0, length: 1, line: 1 },
    ])
    expect(trace.events[1]!.source.file).toBe('/logs/sub/agent-a.jsonl')
  })

  it('merges skipped records per file and reason', () => {
    const trace = traceOf({})
    trace.skipped = [
      { file: 'a', line: 2, reason: 'mode' },
      { file: 'a', line: 5, reason: 'turn-context' },
      { file: 'a', line: 9, reason: 'mode' },
      { file: 'b', line: 1, reason: 'mode' },
    ]
    expect(toView(trace).skipped).toEqual([
      { file: 'a', line: 2, reason: 'mode', count: 2 },
      { file: 'a', line: 5, reason: 'turn-context', count: 1 },
      { file: 'b', line: 1, reason: 'mode', count: 1 },
    ])
    expect(trace.skipped).toHaveLength(4)
  })
})

function big(): Trace {
  const trace = traceOf({ text: 'x'.repeat(10_000) })
  const base = trace.events[0]!
  trace.events = Array.from({ length: 100 }, (_, index) => ({ ...base, id: `e${index}`, seq: index }))
  return trace
}

describe('fitView', () => {
  it('keeps 4,096 when the view fits', () => {
    const fitted = fitView(big(), { maxBytes: 10_000_000 })
    expect(fitted.trace.view).toEqual({ maxString: 4096, budgetBytes: 10_000_000, withinBudget: true })
    expect(fitted.bytes).toBe(new TextEncoder().encode(JSON.stringify(fitted.trace)).byteLength)
  })

  it('lowers the cap in steps until the view fits the budget', () => {
    const fitted = fitView(big(), { maxBytes: 200_000 })
    expect(fitted.trace.view).toEqual({ maxString: 1728, budgetBytes: 200_000, withinBudget: true })
    expect(fitted.bytes).toBeLessThanOrEqual(200_000)
    expect(fitted.trace.events[0]!.payload.text).toHaveLength(1728)
  })

  it('stops at 256 characters and says when the budget is still exceeded', () => {
    const fitted = fitView(big(), { maxBytes: 1000 })
    expect(fitted.trace.view).toEqual({ maxString: 256, budgetBytes: 1000, withinBudget: false })
    expect(fitted.bytes).toBe(new TextEncoder().encode(JSON.stringify(fitted.trace)).byteLength)
  })
})

describe('toView edge cases', () => {
  it('keeps dotted keys unambiguous, caps long keys, and never splits a surrogate pair', () => {
    const emoji = '\u{1F600}'
    const key = 'k'.repeat(256)
    const face = `${'a'.repeat(255)}${emoji}`
    const view = toView(traceOf({ 'a.b': 'x'.repeat(300), [`${key}k`]: 1, face }), { maxString: 256 })
    const payload = view.events[0]!.payload
    expect(payload['a.b']).toBe('x'.repeat(256))
    expect(payload[key]).toBe(1)
    expect(payload.face).toBe('a'.repeat(255))
    expect(payload.$truncated).toEqual([['a.b'], [key], ['face']])
    const fits = `${'a'.repeat(254)}${emoji}`
    expect(toView(traceOf({ face: fits }), { maxString: 256 }).events[0]!.payload.face).toBe(fits)
  })

  it('caps agent titles and skipped reasons', () => {
    const trace = traceOf({})
    trace.agents = [{ id: 'sub', parentId: 'main', title: 't'.repeat(300) }]
    trace.skipped = [{ file: 'f', line: 1, reason: 'r'.repeat(300) }]
    const view = toView(trace, { maxString: 256 })
    expect(view.agents[0]!.title).toBe('t'.repeat(256))
    expect(view.skipped[0]!.reason).toBe('r'.repeat(256))
    expect(trace.agents[0]!.title).toHaveLength(300)
  })
})

describe('toView key collisions', () => {
  it('suffixes long keys that share a prefix after cutting', () => {
    const key = 'a'.repeat(256)
    const view = toView(traceOf({ [`${key}1`]: 1, [`${key}2`]: 2, [key]: 0 }), { maxString: 256 })
    const payload = view.events[0]!.payload
    expect(payload).toMatchObject({ [`${key}#2`]: 1, [`${key}#3`]: 2, [key]: 0 })
    expect(payload.$truncated).toEqual([[`${key}#2`], [`${key}#3`]])
  })
})

describe('toView floor', () => {
  it('raises a cap below 256 to 256, so a tool result keeps its callId and the view stays valid', () => {
    const trace = traceOf({})
    trace.events = [
      { ...trace.events[0]!, kind: 'tool_result', payload: { callId: 'call-1', output: 'o'.repeat(300) } },
    ]
    for (const maxString of [0, 5]) {
      const view = toView(trace, { maxString })
      expect(view.view, String(maxString)).toEqual({ maxString: 256 })
      expect(view.events[0]!.payload, String(maxString)).toEqual({
        callId: 'call-1',
        output: 'o'.repeat(256),
        $truncated: [['output']],
      })
      expect(fitView(trace, { maxString }).trace.view, String(maxString)).toMatchObject({
        maxString: 256,
        withinBudget: true,
      })
    }
  })
})

describe('toView check', () => {
  it('throws with the first issue when the input already breaks the schema', () => {
    // Capping at 256 or more cannot break a view; a timestamp that did not parse can.
    const trace = traceOf({})
    trace.events = [{ ...trace.events[0]!, ts: Number.NaN }]
    expect(() => toView(trace)).toThrow(new TypeError('toView: events.0.ts: Invalid input'))
    expect(() => fitView(trace)).toThrow(new TypeError('fitView: events.0.ts: Invalid input'))
  })
})

describe('capStrings', () => {
  it('cuts strings and keys below the view floor and lists their paths', () => {
    const capped = capStrings({ text: 'abcdef', list: ['xy', 'longer'], abcdefgh: 1, n: 5 }, 4)
    expect(capped.value).toEqual({ text: 'abcd', list: ['xy', 'long'], abcd: 1, n: 5 })
    expect(capped.truncated).toEqual([['text'], ['list', 1], ['abcd']])
  })
})
