import type { CostTotal, RequestCost } from '@rivus/estela-kernel'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { applyLocale } from '@/i18n/locale.ts'
import {
  costHeadline,
  costShort,
  listCostText,
  priceVersionText,
  requestCostDetail,
  requestCostText,
} from './cost-text.ts'

function total(partial: Partial<CostTotal>): CostTotal {
  return {
    requests: 0,
    priced: 0,
    unpriced: { 'no-usage': 0, 'incomplete-usage': 0, 'no-model': 0, 'no-price': 0 },
    unpricedModels: [],
    ...partial,
  }
}

describe('cost text', () => {
  afterEach(() => applyLocale('en'))
  // `applyLocale` sets `<html lang>`; the node environment has no document (see unavailable-note.test.ts).
  const globalDocument = globalThis as { document?: { documentElement: { lang: string } } }
  globalDocument.document ??= { documentElement: { lang: 'en' } }

  it("shows a session row's list cost: a dash before it is priced, unavailable when nothing is, never $0 for unknown", () => {
    expect(listCostText({})).toBe('—')
    expect(listCostText({ requests: 0, unpricedRequests: 0 })).toBe('—')
    expect(listCostText({ requests: 3, costUsd: 0.42 })).toBe('—')
    expect(listCostText({ requests: 3, costUsd: 0.42, unpricedRequests: 0 })).toBe('$0.42')
    expect(listCostText({ requests: 3, costUsd: 0, unpricedRequests: 0 })).toBe('$0.00')
    expect(listCostText({ requests: 3, costUsd: 0.42, unpricedRequests: 2 })).toBe('$0.42 · 2 unpriced')
    expect(listCostText({ requests: 3, unpricedRequests: 3 })).toBe('cost unavailable')
  })

  it('shows a complete sum as it is', () => {
    expect(costHeadline(total({ requests: 2, priced: 2, usd: 1.5 }))).toEqual({ value: '$1.50', unavailable: false })
    expect(costShort(total({ requests: 2, priced: 2, usd: 0.0042 }))).toBe('$0.0042')
  })

  it('says a partial sum is partial', () => {
    const partial = total({ requests: 40, priced: 37, usd: 2, unpriced: { ...total({}).unpriced, 'no-price': 3 } })
    expect(costHeadline(partial)).toEqual({ value: '$2.00', note: '3 of 40 requests unpriced', unavailable: false })
    expect(costShort(partial)).toBe('$2.00 · 3 unpriced')
    applyLocale('zh-CN')
    expect(costHeadline(partial).note).toBe('40 个请求中有 3 个未计价')
  })

  it('says unavailable with the reason, never $0.00', () => {
    const none = total({
      requests: 3,
      unpriced: { 'no-usage': 1, 'incomplete-usage': 0, 'no-model': 0, 'no-price': 2 },
      unpricedModels: ['a', 'b', 'c'],
    })
    expect(costHeadline(none)).toEqual({
      value: 'unavailable',
      note: '1 × no usage recorded, 2 × no price for a, b and 1 more',
      unavailable: true,
    })
    expect(costShort(none)).toBe('cost unavailable')
    expect(costShort(total({}))).toBe('')
    expect(costHeadline(total({})).value).toBe('—')
  })

  it('describes one request: amount, shares of the classes it records, and the hit rate', () => {
    const priced: RequestCost = {
      kind: 'priced',
      eventId: 'r',
      laneId: 'main',
      usd: 0.5,
      shares: { input: 0.1, cacheRead: 0.05, cacheWrite: 0.15, output: 0.2 },
      tokens: { inputTokens: 1000, cacheReadTokens: 900, cacheWriteTokens: 50 },
    }
    expect(requestCostText(priced)).toBe('$0.50')
    expect(requestCostDetail(priced)).toEqual([
      'input $0.10',
      'cache read $0.05',
      'cache write $0.15',
      'output $0.20',
      '90% cache hits',
    ])
    const unpriced: RequestCost = {
      kind: 'unpriced',
      eventId: 'r',
      laneId: 'main',
      reason: 'no-price',
      models: ['claude-test'],
      tokens: { inputTokens: 10 },
    }
    expect(requestCostText(unpriced)).toBe('Cost unavailable: no price for claude-test')
    expect(requestCostDetail(unpriced)).toEqual([])
  })

  it('shortens the snapshot version to its date and commit', () => {
    expect(priceVersionText('2026-11-02+ff3983c1f627ad09a5e36e45cc92a0cec91afb72+12280faa8b67')).toBe(
      'LiteLLM 2026-11-02 · ff3983c',
    )
    expect(priceVersionText('custom')).toBe('custom')
  })
})
