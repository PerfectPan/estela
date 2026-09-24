import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vitest'
import { downsample, fold } from './fold.ts'

const source = { file: 'fixture.json', offset: 0, length: 1, line: 1 }

function event(partial: Partial<TraceEvent> & Pick<TraceEvent, 'id' | 'kind'>): TraceEvent {
  return {
    seq: 0,
    ts: 0,
    payload: {},
    source,
    ...partial,
  }
}

function trace(partial: Partial<Trace> & Pick<Trace, 'events' | 'capabilities'>): Trace {
  return {
    schema: 'agent-trace',
    host: { id: 'demo' },
    session: { id: 's' },
    agents: [{ id: 'main' }],
    skipped: [],
    ...partial,
  }
}

describe('fold', () => {
  it('leaves undeclared capability numbers undefined', () => {
    const summary = fold(trace({
      capabilities: [],
      events: [
        event({ id: 'u', kind: 'user' }),
        event({ id: 'r', kind: 'request', payload: { usage: { inputTokens: 3, outputTokens: 1 }, durationMs: 5 } }),
        event({ id: 't', kind: 'tool_result', payload: { callId: 'c', isError: true } }),
      ],
    }))
    expect(summary.turns).toBe(1)
    expect(summary.failedTools).toBe(1)
    expect(summary.requests).toBeUndefined()
    expect(summary.tokensIn).toBeUndefined()
    expect(summary.tokensOut).toBeUndefined()
    expect(summary.durationMs).toBeUndefined()
    expect(summary.contextShape).toBeUndefined()
  })

  it('sums declared usage and downsamples the context shape', () => {
    const events = Array.from({ length: 121 }, (_, index) => event({
      id: `r${index}`,
      kind: 'request',
      payload: { usage: { inputTokens: index, outputTokens: 1 } },
    }))
    const summary = fold(trace({ capabilities: ['requests', 'usage'], events }))
    expect(summary.requests).toBe(121)
    expect(summary.tokensIn).toBe((120 * 121) / 2)
    expect(summary.contextShape).toHaveLength(120)
    expect(summary.contextShape?.[0]).toBe(0)
    expect(summary.contextShape?.[119]).toBe(120)
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3])
  })
})
