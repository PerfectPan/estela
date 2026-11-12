import type { EventOf, Trace, TraceEvent } from '@rivus/estela-schema'
import { createPricing } from '@rivus/agent-kit/cost'
import { describe, expect, it } from 'vite-plus/test'
import { costOfEvents, priceRequest, priceTrace, sumCosts, type RequestCost, type TracePricing } from './price-trace.ts'
import { snapshotPricing } from './snapshot-pricing.ts'

const source = { file: 'fixture.json', offset: 0, length: 1, line: 1 }

const pricing: TracePricing = {
  version: 'test-1',
  pricing: createPricing({
    // USD per million tokens: easy to check by hand.
    'model-a': { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 2, cacheWrite1h: 4 },
    'model-long': {
      input: 1,
      output: 10,
      cacheRead: 0.1,
      cacheWrite: 2,
      longContext: { thresholdTokens: 1000, input: 2, output: 20, cacheRead: 0.2 },
    },
  }),
}

let seq = 0
function request(id: string, payload: EventOf<'request'>['payload'], agentId?: string): TraceEvent {
  return { id, seq: seq++, ts: 1, kind: 'request', payload, source, ...(agentId ? { agentId } : {}) }
}

function trace(events: TraceEvent[]): Trace {
  return {
    schema: 'estela',
    agent: 'demo',
    session: { id: 's' },
    agents: [{ id: 'main' }, { id: 'sub', parentId: 'main' }],
    skipped: [],
    capabilities: ['requests', 'usage'],
    events,
  }
}

function price(payload: EventOf<'request'>['payload']): RequestCost {
  const event = request('r', payload) as EventOf<'request'>
  return priceRequest(trace([event]), event, pricing.pricing)
}

describe('priceRequest', () => {
  it('prices recorded tokens at the table price, with cache classes as shares', () => {
    const cost = price({
      model: 'model-a',
      usage: { inputTokens: 1_000_000, cacheReadTokens: 600_000, cacheWriteTokens: 300_000, outputTokens: 100_000 },
    })
    expect(cost.kind).toBe('priced')
    if (cost.kind !== 'priced') {
      return
    }
    // 100k plain input × $1 + 600k reads × $0.1 + 300k writes × $2 + 100k output × $10
    expect(cost.usd).toBeCloseTo(0.1 + 0.06 + 0.6 + 1, 10)
    expect(cost.shares?.input).toBeCloseTo(0.1, 10)
    expect(cost.shares?.cacheRead).toBeCloseTo(0.06, 10)
    expect(cost.shares?.cacheWrite).toBeCloseTo(0.6, 10)
    expect(cost.shares?.output).toBeCloseTo(1, 10)
  })

  it('splits one-hour cache writes at their own price', () => {
    const cost = price({
      model: 'model-a',
      usage: { inputTokens: 1_000_000, cacheWriteTokens: 1_000_000, cacheWrite1hTokens: 500_000, outputTokens: 0 },
    })
    expect(cost.kind === 'priced' && cost.usd).toBeCloseTo(0.5 * 2 + 0.5 * 4, 10)
    expect(cost.kind === 'priced' && cost.shares?.cacheWrite).toBeCloseTo(3, 10)
  })

  it('keeps the long-context tier in every share', () => {
    const cost = price({ model: 'model-long', usage: { inputTokens: 2000, cacheReadTokens: 1000, outputTokens: 100 } })
    if (cost.kind !== 'priced') {
      throw new Error('expected a price')
    }
    // Past 1000 input tokens the whole request bills at the tier: 1000 × $2 + 1000 × $0.2 + 100 × $20, per million.
    expect(cost.usd).toBeCloseTo((2000 + 200 + 2000) / 1e6, 12)
    expect(cost.shares?.input).toBeCloseTo(2000 / 1e6, 12)
    expect(cost.shares?.cacheRead).toBeCloseTo(200 / 1e6, 12)
    expect(cost.shares?.output).toBeCloseTo(2000 / 1e6, 12)
  })

  it('leaves a model without a price unpriced, never 0', () => {
    const cost = price({ model: 'gpt-unknown', usage: { inputTokens: 10, outputTokens: 5 } })
    expect(cost).toMatchObject({ kind: 'unpriced', reason: 'no-price', models: ['gpt-unknown'] })
    expect('usd' in cost).toBe(false)
  })

  it('names missing or incomplete usage and a missing model', () => {
    expect(price({ model: 'model-a' })).toMatchObject({ kind: 'unpriced', reason: 'no-usage' })
    expect(price({ model: 'model-a', usage: { outputTokens: 5 } })).toMatchObject({ reason: 'incomplete-usage' })
    expect(price({ usage: { inputTokens: 1, outputTokens: 5 } })).toMatchObject({ reason: 'no-model' })
  })

  it('costs nothing for a request that records zero tokens, whatever its model', () => {
    expect(price({ model: '<synthetic>', usage: { inputTokens: 0, outputTokens: 0 } })).toMatchObject({
      kind: 'priced',
      usd: 0,
    })
  })

  it('prices an aggregate split by model, and only when every model has a price', () => {
    const split = {
      granularity: 'turn' as const,
      modelCalls: 3,
      usageByModel: {
        'model-a': { usage: { inputTokens: 1_000_000, outputTokens: 0 }, modelCalls: 2 },
        'model-long': { usage: { inputTokens: 2000, outputTokens: 0 }, modelCalls: 1 },
      },
    }
    const cost = price(split)
    // The single-call part bills at its tier: 2000 × $2.
    expect(cost.kind === 'priced' && cost.usd).toBeCloseTo(1 + 0.004, 10)
    expect(cost.tokens.inputTokens).toBe(1_002_000)
    const mixed = price({
      ...split,
      usageByModel: { ...split.usageByModel, 'model-x': { usage: { inputTokens: 1, outputTokens: 1 } } },
    })
    expect(mixed).toMatchObject({ kind: 'unpriced', reason: 'no-price', models: ['model-x'] })
  })
})

describe('priceTrace and sumCosts', () => {
  const events = [
    request('r1', { model: 'model-a', usage: { inputTokens: 1000, cacheReadTokens: 800, outputTokens: 10 } }),
    request('r2', { model: 'gpt-unknown', usage: { inputTokens: 1000, cacheReadTokens: 0, outputTokens: 10 } }),
    request('r3', { model: 'model-a' }),
    request('r4', { model: 'model-a', usage: { inputTokens: 2000, outputTokens: 20 } }, 'sub'),
  ]
  const cost = priceTrace(trace(events), pricing)

  it('sums the priced requests and says how many are not priced, by reason', () => {
    expect(cost.version).toBe('test-1')
    expect(cost.total).toMatchObject({ requests: 4, priced: 2, unpricedModels: ['gpt-unknown'] })
    expect(cost.total.unpriced).toEqual({ 'no-usage': 1, 'incomplete-usage': 0, 'no-model': 0, 'no-price': 1 })
    const r1 = (200 * 1 + 800 * 0.1 + 10 * 10) / 1e6
    const r4 = (2000 * 1 + 20 * 10) / 1e6
    expect(cost.total.usd).toBeCloseTo(r1 + r4, 12)
  })

  it('computes the cache hit rate over the requests that record cache reads', () => {
    // r1 and r2 record cache reads (800 of 2000 input); r4 records none and does not count.
    expect(cost.total.cacheHitRate).toBeCloseTo(0.4, 10)
  })

  it('totals each lane on its own', () => {
    expect(cost.lanes.get('main')).toMatchObject({ requests: 3, priced: 1 })
    expect(cost.lanes.get('sub')).toMatchObject({ requests: 1, priced: 1 })
    expect(cost.lanes.get('sub')?.usd).toBeCloseTo(2200 / 1e6, 12)
    expect(cost.lanes.get('sub')?.cacheHitRate).toBeUndefined()
  })

  it('sums a subset of events, ignoring events that are not requests', () => {
    const turn = costOfEvents(cost, ['r2', 'r3', 'not-a-request'])
    expect(turn).toMatchObject({ requests: 2, priced: 0 })
    expect(turn.usd).toBeUndefined()
    expect(sumCosts([])).toMatchObject({ requests: 0, priced: 0 })
    expect(sumCosts([]).usd).toBeUndefined()
  })
})

describe('snapshotPricing', () => {
  it('prices a model of the kit snapshot and names its version', () => {
    const snapshot = snapshotPricing()
    expect(snapshot.version).toMatch(/^\d{4}-\d{2}-\d{2}\+[0-9a-f]{40}\+[0-9a-f]{12}$/)
    expect(snapshot.pricing.priceOf('claude-sonnet-4-5-20250929')).toBeDefined()
    expect(snapshot.pricing.priceOf('claude-test')).toBeUndefined()
  })
})
