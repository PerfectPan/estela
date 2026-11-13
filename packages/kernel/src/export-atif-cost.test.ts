import type { EventOf, Trace, TraceEvent } from '@rivus/estela-schema'
import { createPricing } from '@rivus/agent-kit/cost'
import { describe, expect, it } from 'vite-plus/test'
import { toAtif } from './export-atif.ts'

const SOURCE = { file: 'fixture.jsonl', offset: 0, length: 10, line: 1 }
const pricing = {
  version: 'test-prices',
  pricing: createPricing({ 'model-a': { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 2 } }),
}

function event(id: string, seq: number, partial: Partial<TraceEvent> & Pick<TraceEvent, 'kind' | 'payload'>) {
  return { ...partial, id, seq, ts: seq, source: SOURCE } as TraceEvent
}

function request(id: string, seq: number, payload: EventOf<'request'>['payload'], agentId?: string): TraceEvent {
  return event(id, seq, { kind: 'request', requestId: `q-${id}`, payload, ...(agentId ? { agentId } : {}) })
}

function traceOf(events: TraceEvent[]): Trace {
  return {
    schema: 'estela',
    agent: 'test-agent',
    session: { id: 's1' },
    capabilities: ['requests', 'usage', 'subagents'],
    agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 'spawn' }],
    skipped: [],
    events,
  }
}

const priced = { model: 'model-a', usage: { inputTokens: 1_000_000, outputTokens: 100_000 } }

describe('toAtif with prices', () => {
  it('sets cost_usd per step and total_cost_usd, subagents included, when every request is priced', () => {
    const atif = toAtif(
      traceOf([
        event('u', 0, { kind: 'user', payload: { text: 'go' } }),
        request('r1', 1, priced),
        event('spawn', 2, { kind: 'tool_call', requestId: 'q-r1', payload: { callId: 'spawn', name: 'Task' } }),
        request('r2', 3, priced, 'sub'),
        event('a2', 4, { kind: 'assistant', requestId: 'q-r2', agentId: 'sub', payload: { text: 'sub done' } }),
      ]),
      { pricing },
    )
    expect(atif.steps[1]?.metrics?.cost_usd).toBeCloseTo(2, 10)
    expect(atif.subagent_trajectories?.[0]?.final_metrics?.total_cost_usd).toBeCloseTo(2, 10)
    expect(atif.final_metrics?.total_cost_usd).toBeCloseTo(4, 10)
    expect(atif.extra?.estela?.pricing).toEqual({ version: 'test-prices', unpricedRequests: 0 })
    expect(atif.notes).toContain('list price')
  })

  it('omits the total when a request is unpriced, and the step cost of that request', () => {
    const atif = toAtif(
      traceOf([
        event('u', 0, { kind: 'user', payload: { text: 'go' } }),
        request('r1', 1, priced),
        event('u2', 2, { kind: 'user', payload: { text: 'again' } }),
        request('r2', 3, { model: 'model-unknown', usage: { inputTokens: 10, outputTokens: 1 } }),
      ]),
      { pricing },
    )
    expect(atif.steps[1]?.metrics?.cost_usd).toBeCloseTo(2, 10)
    expect(atif.steps[3]?.metrics?.prompt_tokens).toBe(10)
    expect(atif.steps[3]?.metrics?.cost_usd).toBeUndefined()
    expect(atif.final_metrics?.total_cost_usd).toBeUndefined()
    expect(atif.extra?.estela?.pricing).toEqual({ version: 'test-prices', unpricedRequests: 1 })
  })

  it('counts requests a compaction hid in the totals, though they produce no step', () => {
    const hidden = (id: string, seq: number, payload: EventOf<'request'>['payload']) => ({
      ...request(id, seq, payload),
      shadowedBy: 'c',
    })
    const events = [
      { ...event('u', 0, { kind: 'user', payload: { text: 'go' } }), shadowedBy: 'c' },
      hidden('r1', 1, priced),
      hidden('r2', 2, { model: 'model-unknown', usage: { inputTokens: 10, outputTokens: 1 } }),
      event('c', 3, { kind: 'compaction', payload: { trigger: 'auto' } }),
      event('u2', 4, { kind: 'user', payload: { text: 'again' } }),
      request('r3', 5, priced),
    ]
    const atif = toAtif(traceOf(events), { pricing })
    expect(atif.final_metrics?.total_cost_usd).toBeUndefined()
    expect(atif.extra?.estela?.pricing).toEqual({ version: 'test-prices', unpricedRequests: 1 })
    const allPriced = toAtif(traceOf(events.filter(item => item.id !== 'r2')), { pricing })
    // The hidden priced request counts: $2 before the compaction and $2 after.
    expect(allPriced.final_metrics?.total_cost_usd).toBeCloseTo(4, 10)
  })

  it('adds no cost field without a price table', () => {
    const atif = toAtif(traceOf([event('u', 0, { kind: 'user', payload: { text: 'go' } }), request('r1', 1, priced)]))
    expect(atif.steps[1]?.metrics?.cost_usd).toBeUndefined()
    expect(atif.final_metrics?.total_cost_usd).toBeUndefined()
    expect(atif.extra?.estela?.pricing).toBeUndefined()
  })
})
