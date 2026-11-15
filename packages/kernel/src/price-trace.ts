import type { Pricing } from '@rivus/agent-kit/cost'
import type { UsageRecord } from '@rivus/agent-kit/transcript/usage'
import type { EventOf, Trace } from '@rivus/estela-schema'
import { priceRecord } from '@rivus/agent-kit/cost'
import { laneOf, mainAgentId } from './lanes.ts'

type Usage = UsageRecord['usage']

/** A price lookup and the version of the table behind it, which every cost shown or exported names. */
export interface TracePricing {
  readonly pricing: Pricing
  /** The table's version, such as the kit's `litellmPricesVersion`. */
  readonly version: string
}

/**
 * Why a request has no cost. In order of precedence: `no-usage` (the request records no token counts),
 * `incomplete-usage` (input or output tokens missing, so a sum would undercount), `no-model`, and `no-price`
 * (the table has no price for the model).
 */
export type UnpricedReason = 'no-usage' | 'incomplete-usage' | 'no-model' | 'no-price'

export const UNPRICED_REASONS: readonly UnpricedReason[] = ['no-usage', 'incomplete-usage', 'no-model', 'no-price']

/** USD of each token class of a priced request: input without cache, cache reads, cache writes, output. */
interface CostShares {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** The cache token classes a request recorded, for the hit rate; a class the agent did not record is absent. */
interface CacheTokens {
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

interface RequestCostBase {
  eventId: string
  laneId: string
  tokens: CacheTokens
}

interface PricedRequest extends RequestCostBase {
  kind: 'priced'
  usd: number
  /** Absent when the counts do not add up (cache reads and writes above the input) or a split part lacks shares. */
  shares?: CostShares
}

interface UnpricedRequest extends RequestCostBase {
  kind: 'unpriced'
  reason: UnpricedReason
  /** For `no-price`: the model ids the table has no price for. */
  models: string[]
}

export type RequestCost = PricedRequest | UnpricedRequest

/** Cost of a set of requests: a sum over the priced ones, and what the rest lacked. */
export interface CostTotal {
  requests: number
  priced: number
  /** Sum over the priced requests; `undefined` when none is priced, never 0 for "unknown". */
  usd?: number
  /** Unpriced requests per reason. */
  unpriced: Record<UnpricedReason, number>
  /** Distinct model ids without a price, in first-seen order. */
  unpricedModels: string[]
  /** Sum of the shares; only when every priced request has them. */
  shares?: CostShares
  /** Cache reads over input tokens, across the requests that record both; `undefined` when none does. */
  cacheHitRate?: number
}

/** Every request of a trace priced, with totals for the whole trace and per lane. */
export interface TraceCost {
  version: string
  /** By request event id. */
  requests: Map<string, RequestCost>
  total: CostTotal
  /** By lane id; the main lane's total holds only its own requests. */
  lanes: Map<string, CostTotal>
}

const SPLIT_LIMIT = 1e-9

function hasCounts(usage: Usage | undefined): usage is Usage {
  return (
    usage !== undefined
    && (usage.inputTokens !== undefined
      || usage.outputTokens !== undefined
      || usage.cacheReadTokens !== undefined
      || usage.cacheWriteTokens !== undefined)
  )
}

function cacheTokens(usage: Usage | undefined): CacheTokens {
  const out: CacheTokens = {}
  if (usage?.inputTokens !== undefined) {
    out.inputTokens = usage.inputTokens
  }
  if (usage?.cacheReadTokens !== undefined) {
    out.cacheReadTokens = usage.cacheReadTokens
  }
  if (usage?.cacheWriteTokens !== undefined) {
    out.cacheWriteTokens = usage.cacheWriteTokens
  }
  return out
}

/** The whole request's usage: its own, else its split by model added up. */
function requestTokens(payload: EventOf<'request'>['payload']): CacheTokens {
  if (hasCounts(payload.usage)) {
    return cacheTokens(payload.usage)
  }
  const sum: CacheTokens = {}
  for (const share of Object.values(payload.usageByModel ?? {})) {
    for (const [key, value] of Object.entries(cacheTokens(share.usage)) as [keyof CacheTokens, number][]) {
      sum[key] = (sum[key] ?? 0) + value
    }
  }
  return sum
}

interface Part {
  model?: string
  usage: Usage
  /** Whether the kit bills this part as one request (its long-context tier can apply). */
  single: boolean
}

/** The record the kit prices for one request event. Absent granularity is one request, as the adapters write it. */
function recordOf(trace: Trace, event: EventOf<'request'>, usage: Usage): UsageRecord {
  const payload = event.payload
  return {
    agent: trace.agent,
    sessionId: trace.session.id,
    granularity: payload.granularity ?? 'request',
    modelCalls: payload.modelCalls,
    model: payload.model,
    usage,
    usageByModel: payload.usageByModel,
    timestamp: event.ts,
    source: event.source,
  }
}

function partsOf(event: EventOf<'request'>): Part[] {
  const payload = event.payload
  const granularity = payload.granularity ?? 'request'
  const split = Object.entries(payload.usageByModel ?? {})
  if (split.length > 0) {
    return split.map(([model, share]) => ({
      model,
      usage: share.usage,
      single: granularity === 'request' || share.modelCalls === 1 || payload.modelCalls === 1,
    }))
  }
  return [
    { model: payload.model, usage: payload.usage ?? {}, single: granularity === 'request' || payload.modelCalls === 1 },
  ]
}

/** USD of `usage` for one part, billed the way the kit bills that part (`priceRecord`). */
function partCost(trace: Trace, event: EventOf<'request'>, part: Part, usage: Usage, pricing: Pricing): number {
  const record: UsageRecord = {
    ...recordOf(trace, event, usage),
    granularity: part.single ? 'request' : (event.payload.granularity ?? 'request'),
    modelCalls: part.single ? 1 : undefined,
    model: part.model,
    usageByModel: undefined,
  }
  return priceRecord(record, pricing).parts[0]?.cost?.costUsd ?? Number.NaN
}

/**
 * The part's cost by token class, from the kit's own price (`priceRecord`) rather than a second copy of its
 * formula. Every probe keeps the part's input tokens, so the long-context tier is decided as for the whole part;
 * with input fixed the cost is linear in each class, so three probes give the rates: `a·I` with no cache, then
 * with only cache reads, then with only cache writes. The shares add up to the kit's total. Counts whose cache
 * reads and writes exceed the input break that linearity, and get no shares.
 */
function partShares(trace: Trace, event: EventOf<'request'>, part: Part, pricing: Pricing): CostShares | undefined {
  const { usage } = part
  const input = usage.inputTokens ?? 0
  const read = usage.cacheReadTokens ?? 0
  const write = usage.cacheWriteTokens ?? 0
  if (read + write > input) {
    return undefined
  }
  const cost = (probe: Usage) => partCost(trace, event, part, probe, pricing)
  const total = cost(usage)
  const noOutput = cost({ ...usage, outputTokens: 0 })
  if (input === 0) {
    return { input: 0, cacheRead: 0, cacheWrite: 0, output: total - noOutput }
  }
  const plain = cost({ inputTokens: input })
  const withRead = cost({ inputTokens: input, cacheReadTokens: read })
  const withWrite = cost({
    inputTokens: input,
    cacheWriteTokens: write,
    cacheWrite1hTokens: usage.cacheWrite1hTokens,
  })
  const perInput = plain / input
  const shares = {
    input: perInput * (input - read - write),
    cacheRead: withRead - perInput * (input - read),
    cacheWrite: withWrite - perInput * (input - write),
    output: total - noOutput,
  }
  return Object.values(shares).every(Number.isFinite) ? shares : undefined
}

function addShares(into: CostShares, add: CostShares): void {
  into.input += add.input
  into.cacheRead += add.cacheRead
  into.cacheWrite += add.cacheWrite
  into.output += add.output
}

/**
 * One request event priced at the table's prices. A request is priced only when every part of it is: its model
 * has a price and it records input and output tokens; otherwise it is unpriced with the first reason that
 * applies. A request that records 0 input and 0 output tokens costs 0 whatever its model, since nothing is billed.
 */
export function priceRequest(trace: Trace, event: EventOf<'request'>, pricing: Pricing): RequestCost {
  const laneId = laneOf(event, mainAgentId(trace))
  const base = { eventId: event.id, laneId, tokens: requestTokens(event.payload) }
  const unpriced = (reason: UnpricedReason, models: string[] = []): UnpricedRequest => ({
    ...base,
    kind: 'unpriced',
    reason,
    models,
  })
  const parts = partsOf(event)
  if (!parts.some(part => hasCounts(part.usage))) {
    return unpriced('no-usage')
  }
  if (parts.some(part => part.usage.inputTokens === undefined || part.usage.outputTokens === undefined)) {
    return unpriced('incomplete-usage')
  }
  const empty = (usage: Usage) =>
    usage.inputTokens === 0 && usage.outputTokens === 0 && !usage.cacheReadTokens && !usage.cacheWriteTokens
  if (parts.every(part => empty(part.usage))) {
    return { ...base, kind: 'priced', usd: 0, shares: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 } }
  }
  if (parts.some(part => part.model === undefined)) {
    return unpriced('no-model')
  }
  const missing = parts.flatMap(part => (pricing.priceOf(part.model!) === undefined ? [part.model!] : []))
  if (missing.length > 0) {
    return unpriced('no-price', [...new Set(missing)])
  }
  const priced = priceRecord(recordOf(trace, event, event.payload.usage ?? {}), pricing).parts
  let usd = 0
  for (const part of priced) {
    usd += part.cost?.costUsd ?? Number.NaN
  }
  if (!Number.isFinite(usd)) {
    return unpriced(
      'no-price',
      parts.map(part => part.model!),
    )
  }
  let shares: CostShares | undefined = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  for (const part of parts) {
    const own = partShares(trace, event, part, pricing)
    if (own === undefined) {
      shares = undefined
      break
    }
    addShares(shares, own)
  }
  // The probes and the whole record go through one formula; a drift beyond rounding means the split is not linear.
  if (shares !== undefined) {
    const sum = shares.input + shares.cacheRead + shares.cacheWrite + shares.output
    if (Math.abs(sum - usd) > SPLIT_LIMIT * Math.max(1, usd)) {
      shares = undefined
    }
  }
  return shares === undefined ? { ...base, kind: 'priced', usd } : { ...base, kind: 'priced', usd, shares }
}

/** Totals of some request costs: priced sum, unpriced counts by reason, shares, and the cache hit rate. */
export function sumCosts(costs: Iterable<RequestCost>): CostTotal {
  const total: CostTotal = {
    requests: 0,
    priced: 0,
    unpriced: { 'no-usage': 0, 'incomplete-usage': 0, 'no-model': 0, 'no-price': 0 },
    unpricedModels: [],
  }
  let shares: CostShares | undefined = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  let input = 0
  let read = 0
  let hitKnown = false
  for (const cost of costs) {
    total.requests += 1
    const { inputTokens, cacheReadTokens } = cost.tokens
    if (inputTokens !== undefined && cacheReadTokens !== undefined) {
      input += inputTokens
      read += cacheReadTokens
      hitKnown = true
    }
    if (cost.kind === 'unpriced') {
      total.unpriced[cost.reason] += 1
      for (const model of cost.models) {
        if (!total.unpricedModels.includes(model)) {
          total.unpricedModels.push(model)
        }
      }
      continue
    }
    total.priced += 1
    total.usd = (total.usd ?? 0) + cost.usd
    if (shares !== undefined && cost.shares !== undefined) {
      addShares(shares, cost.shares)
    } else {
      shares = undefined
    }
  }
  if (total.priced > 0 && shares !== undefined) {
    total.shares = shares
  }
  if (hitKnown && input > 0) {
    total.cacheHitRate = read / input
  }
  return total
}

/** Every `request` event priced, with the trace total and one total per lane that has requests. */
export function priceTrace(trace: Trace, pricing: TracePricing): TraceCost {
  const requests = new Map<string, RequestCost>()
  const byLane = new Map<string, RequestCost[]>()
  for (const event of trace.events) {
    if (event.kind !== 'request') {
      continue
    }
    const cost = priceRequest(trace, event, pricing.pricing)
    requests.set(event.id, cost)
    const lane = byLane.get(cost.laneId)
    if (lane) {
      lane.push(cost)
    } else {
      byLane.set(cost.laneId, [cost])
    }
  }
  return {
    version: pricing.version,
    requests,
    total: sumCosts(requests.values()),
    lanes: new Map([...byLane].map(([laneId, costs]) => [laneId, sumCosts(costs)])),
  }
}

/** The request costs among `eventIds` (a turn's events, say), summed. */
export function costOfEvents(cost: TraceCost, eventIds: Iterable<string>): CostTotal {
  const found: RequestCost[] = []
  for (const id of eventIds) {
    const request = cost.requests.get(id)
    if (request) {
      found.push(request)
    }
  }
  return sumCosts(found)
}
