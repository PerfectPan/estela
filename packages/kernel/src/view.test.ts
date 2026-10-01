import type { Trace } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vitest'
import { fitView, toView } from './view.ts'

function traceOf(payload: Record<string, unknown>, session: Trace['session'] = { id: 's' }): Trace {
  return {
    schema: 'agent-trace',
    host: { id: 'demo' },
    session,
    capabilities: [],
    agents: [],
    skipped: [],
    events: [{
      id: 'e',
      seq: 0,
      ts: 0,
      kind: 'tool_result',
      payload,
      source: { file: 'fixture.json', offset: 0, length: 1, line: 1 },
      original: { secret: 'keep-me-out' },
    }],
  }
}

describe('toView', () => {
  it('drops original and caps long strings', () => {
    const trace = traceOf({ text: 'x'.repeat(20) })
    const view = toView(trace, { maxString: 8 })
    expect(view.events[0]?.original).toBeUndefined()
    expect('original' in view.events[0]!).toBe(false)
    expect(view.events[0]?.payload.text).toBe('xxxxxxxx')
    expect(view.events[0]?.payload.$truncated).toEqual([['text']])
    expect(view.view).toEqual({ maxString: 8 })
    expect(trace.events[0]?.original).toEqual({ secret: 'keep-me-out' })
  })

  it('defaults to 4,096 characters and records nested and array paths', () => {
    const long = 'y'.repeat(5000)
    const view = toView(traceOf({
      callId: 'c1',
      output: { stdout: long, lines: ['short', long], exact: 'z'.repeat(4096) },
      count: 3,
    }))
    const payload = view.events[0]!.payload
    const output = payload.output as { stdout: string, lines: string[], exact: string }
    expect(output.stdout).toHaveLength(4096)
    expect(output.lines).toEqual(['short', 'y'.repeat(4096)])
    expect(output.exact).toHaveLength(4096)
    expect(payload.count).toBe(3)
    expect(payload.callId).toBe('c1')
    expect(payload.$truncated).toEqual([['output', 'stdout'], ['output', 'lines', 1]])
  })

  it('leaves events with no long string unmarked', () => {
    const view = toView(traceOf({ text: 'short' }))
    expect(view.events[0]?.payload).toEqual({ text: 'short' })
  })

  it('caps session strings and marks them on the session', () => {
    const view = toView(traceOf({}, { id: 's', systemPrompt: 'p'.repeat(20), tools: [{ description: 'd'.repeat(20) }] }), { maxString: 12 })
    expect(view.session.systemPrompt).toBe('p'.repeat(12))
    expect(view.session.$truncated).toEqual([['systemPrompt'], ['tools', 0, 'description']])
  })

  it('does not mutate the input, and replaces a stale marker', () => {
    const trace = traceOf({ text: 'x'.repeat(20), $truncated: ['stale'] })
    const before = structuredClone(trace)
    const view = toView(trace, { maxString: 8 })
    expect(trace).toEqual(before)
    expect(view.events[0]?.payload.$truncated).toEqual([['text']])
    expect(view.events[0]).not.toBe(trace.events[0])
  })

  it('interns source files and keeps record identity', () => {
    const trace = traceOf({ text: 'a' })
    trace.events.push(
      { ...trace.events[0]!, id: 'f', seq: 1, source: { file: '/logs/sub/agent-a.jsonl', offset: 5, length: 2, line: 3 } },
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
    expect((fitted.trace.events[0]!.payload.text as string)).toHaveLength(1728)
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
    const view = toView(traceOf({ 'a.b': 'x'.repeat(10), ['k'.repeat(10)]: 1, face: `abc${emoji}` }), { maxString: 4 })
    const payload = view.events[0]!.payload
    expect(payload['a.b']).toBe('xxxx')
    expect(payload.kkkk).toBe(1)
    expect(payload.face).toBe('abc')
    expect(payload.$truncated).toEqual([['a.b'], ['kkkk'], ['face']])
    expect(toView(traceOf({ face: `abcd${emoji}` }), { maxString: 6 }).events[0]!.payload.face).toBe(`abcd${emoji}`)
  })

  it('caps agent titles and skipped reasons', () => {
    const trace = traceOf({})
    trace.agents = [{ id: 'sub', parentId: 'main', title: 't'.repeat(10) }]
    trace.skipped = [{ file: 'f', line: 1, reason: 'r'.repeat(10) }]
    const view = toView(trace, { maxString: 3 })
    expect(view.agents[0]!.title).toBe('ttt')
    expect(view.skipped[0]!.reason).toBe('rrr')
    expect(trace.agents[0]!.title).toHaveLength(10)
  })
})

describe('toView key collisions', () => {
  it('suffixes long keys that share a prefix after cutting', () => {
    const view = toView(traceOf({ ['a'.repeat(10) + '1']: 1, ['a'.repeat(10) + '2']: 2, aaaa: 0 }), { maxString: 4 })
    const payload = view.events[0]!.payload
    expect(payload).toMatchObject({ 'aaaa#2': 1, 'aaaa#3': 2, 'aaaa': 0 })
    expect(payload.$truncated).toEqual([['aaaa#2'], ['aaaa#3']])
  })
})
