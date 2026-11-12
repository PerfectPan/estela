import type { TracePricing } from './price-trace.ts'
import { createPricing } from '@rivus/agent-kit/cost'
import { litellmPrices, litellmPricesVersion } from '@rivus/agent-kit/cost/prices'

let snapshot: TracePricing | undefined

/**
 * The kit's LiteLLM price snapshot as a `TracePricing`, built on first use so a bundle that never prices (rpc)
 * drops the table. Its version is `litellmPricesVersion`: `<date>+<commit>+<digest>`.
 */
export function snapshotPricing(): TracePricing {
  snapshot ??= { pricing: createPricing(litellmPrices), version: litellmPricesVersion }
  return snapshot
}
