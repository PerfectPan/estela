import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { describe, expect, it } from 'vite-plus/test'
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
    agent: { id: 'demo' },
    session: { id: 's' },
    agents: [{ id: 'main' }],
    skipped: [],
    ...partial,
  }
}

describe('fold', () => {
  it('leaves undeclared capability numbers undefined', () => {
    const summary = fold(
      trace({
        capabilities: [],
        events: [
          event({ id: 'u', kind: 'user' }),
          event({ id: 'r', kind: 'request', payload: { usage: { inputTokens: 3, outputTokens: 1 }, durationMs: 5 } }),
          event({ id: 't', kind: 'tool_result', payload: { callId: 'c', isError: true } }),
        ],
      }),
    )
    expect(summary.turns).toBe(1)
    expect(summary.failedTools).toBe(1)
    expect(summary.requests).toBeUndefined()
    expect(summary.inputTokens).toBeUndefined()
    expect(summary.outputTokens).toBeUndefined()
    expect(summary.durationMs).toBeUndefined()
    expect(summary.contextShape).toBeUndefined()
  })

  it('counts a turn only for a real main-lane user prompt', () => {
    const summary = fold(
      trace({
        capabilities: [],
        agents: [{ id: 'main' }, { id: 'child', parentId: 'main' }],
        events: [
          event({ id: 'u', kind: 'user' }),
          event({ id: 'm', kind: 'user', payload: { meta: true } }),
          event({ id: 'c', kind: 'user', payload: { compactSummary: true } }),
          event({ id: 'k', kind: 'user', payload: { command: true } }),
          event({ id: 'i', kind: 'user', payload: { injected: true } }),
          event({ id: 's', kind: 'user', agentId: 'child' }),
          event({ id: 'u-block', kind: 'user' }),
          event({ id: 'n', kind: 'user', payload: { continued: true }, source: { ...source, line: 3 } }),
          event({ id: 'v', kind: 'user', source: { ...source, line: 2 } }),
        ],
      }),
    )
    expect(summary.turns).toBe(2)
  })

  it('sums turn durations, and request durations only when no turn has one', () => {
    const request = event({ id: 'r', kind: 'request', payload: { durationMs: 7 } })
    const turn = event({ id: 't', kind: 'system', payload: { type: 'turn_duration', durationMs: 40 } })
    expect(fold(trace({ capabilities: ['durations'], events: [request, turn] })).durationMs).toBe(40)
    expect(fold(trace({ capabilities: ['durations'], events: [request] })).durationMs).toBe(7)
  })

  it('sums declared usage and downsamples the context shape', () => {
    const events = Array.from({ length: 121 }, (_, index) =>
      event({
        id: `r${index}`,
        kind: 'request',
        payload: { usage: { inputTokens: index, outputTokens: 1 } },
      }),
    )
    const summary = fold(trace({ capabilities: ['requests', 'usage'], events }))
    expect(summary.requests).toBe(121)
    expect(summary.inputTokens).toBe((120 * 121) / 2)
    expect(summary.contextShape).toHaveLength(120)
    expect(summary.contextShape?.[0]).toBe(0)
    expect(summary.contextShape?.[119]).toBe(120)
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3])
  })
})
