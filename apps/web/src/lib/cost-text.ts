import type { CostTotal, RequestCost, UnpricedReason } from '@rivus/estela-kernel'
import { UNPRICED_REASONS } from '@rivus/estela-kernel'
import { locale, translate as t } from '@/i18n/locale.ts'
import { formatNumber, formatPercent, formatUsd } from './format.ts'

/** Model ids named in a "no price" reason before the rest are counted. */
const NAMED_MODELS = 2

/** `LiteLLM 2026-11-02 · ff3983c` from the kit's `<date>+<commit>+<digest>`; another shape is shown as it is. */
export function priceVersionText(version: string): string {
  const [date, commit] = version.split('+')
  if (!date || !commit) {
    return version
  }
  return t('cost.version', { date, commit: commit.slice(0, 7) })
}

/** The tooltip that says what the number is and which table priced it. */
export function costBasisText(version: string): string {
  return t('cost.basis', { version: priceVersionText(version) })
}

function reasonText(reason: UnpricedReason, models: readonly string[]): string {
  if (reason !== 'no-price') {
    return t(`cost.reasons.${reason}`)
  }
  const named = models.slice(0, NAMED_MODELS).join(', ')
  const list =
    models.length > NAMED_MODELS
      ? t('cost.moreModels', { models: named, count: formatNumber(models.length - NAMED_MODELS, locale()) })
      : named
  return t('cost.reasons.no-price', { models: list })
}

/** Why requests are unpriced: one reason as it is, several with their counts. */
function unpricedText(total: CostTotal): string {
  const present = UNPRICED_REASONS.filter(reason => total.unpriced[reason] > 0)
  if (present.length === 1) {
    return reasonText(present[0]!, total.unpricedModels)
  }
  return present
    .map(reason =>
      t('cost.reasonCount', {
        count: formatNumber(total.unpriced[reason], locale()),
        reason: reasonText(reason, total.unpricedModels),
      }),
    )
    .join(t('inspector.listSeparator'))
}

export interface CostHeadline {
  /** The amount, "unavailable", or the dash when there are no requests. */
  value: string
  /** Partial: how many requests are unpriced; unavailable: why. */
  note?: string
  unavailable: boolean
}

/** The session header's cost: a sum that says when it is partial, or "unavailable" with the reason. */
export function costHeadline(total: CostTotal): CostHeadline {
  if (total.requests === 0) {
    return { value: t('common.dash'), unavailable: false }
  }
  if (total.usd === undefined) {
    return { value: t('cost.unavailable'), note: unpricedText(total), unavailable: true }
  }
  const value = formatUsd(total.usd, locale())
  if (total.priced < total.requests) {
    const note = t('cost.partial', {
      unpriced: formatNumber(total.requests - total.priced, locale()),
      total: formatNumber(total.requests, locale()),
    })
    return { value, note, unavailable: false }
  }
  return { value, unavailable: false }
}

/** A turn's or lane's cost for a header: `$0.42`, `$0.42 · 2 unpriced`, or "cost unavailable"; empty without requests. */
export function costShort(total: CostTotal): string {
  if (total.requests === 0) {
    return ''
  }
  if (total.usd === undefined) {
    return t('cost.unavailableShort')
  }
  const value = formatUsd(total.usd, locale())
  return total.priced < total.requests
    ? t('cost.partialShort', { value, count: formatNumber(total.requests - total.priced, locale()) })
    : value
}

/**
 * A session row's cost: `$0.42`, `$0.42 · 2 unpriced`, "cost unavailable" when no request is priced, or a dash
 * without requests or before the summary is done.
 */
export function listCostText(row: { requests?: number; costUsd?: number; unpricedRequests?: number }): string {
  if (row.unpricedRequests === undefined || !row.requests) {
    return t('common.dash')
  }
  if (row.costUsd === undefined) {
    return t('cost.unavailableShort')
  }
  const value = formatUsd(row.costUsd, locale())
  return row.unpricedRequests > 0
    ? t('cost.partialShort', { value, count: formatNumber(row.unpricedRequests, locale()) })
    : value
}

/** One request's cost in the inspector: the amount, or why there is none. */
export function requestCostText(cost: RequestCost): string {
  return cost.kind === 'priced'
    ? formatUsd(cost.usd, locale())
    : t('cost.requestUnavailable', { reason: reasonText(cost.reason, cost.models) })
}

/** The token-class shares of a priced request, and its cache hit rate when it records cache reads. */
export function requestCostDetail(cost: RequestCost): string[] {
  const out: string[] = []
  if (cost.kind === 'priced' && cost.shares) {
    const { input, cacheRead, cacheWrite, output } = cost.shares
    const share = (key: 'input' | 'cacheRead' | 'cacheWrite' | 'output', value: number) =>
      t('cost.share', { label: t(`cost.${key}`), value: formatUsd(value, locale()) })
    out.push(share('input', input))
    if (cost.tokens.cacheReadTokens !== undefined) {
      out.push(share('cacheRead', cacheRead))
    }
    if (cost.tokens.cacheWriteTokens !== undefined) {
      out.push(share('cacheWrite', cacheWrite))
    }
    out.push(share('output', output))
  }
  const { inputTokens, cacheReadTokens } = cost.tokens
  if (inputTokens !== undefined && cacheReadTokens !== undefined && inputTokens > 0) {
    out.push(t('cost.hitRate', { value: formatPercent(cacheReadTokens / inputTokens, locale()) }))
  }
  return out
}

/** Session-wide shares and hit rate, for the header tooltip. */
export function totalCostDetail(total: CostTotal): string[] {
  const out: string[] = []
  if (total.shares) {
    for (const key of ['input', 'cacheRead', 'cacheWrite', 'output'] as const) {
      out.push(t('cost.share', { label: t(`cost.${key}`), value: formatUsd(total.shares[key], locale()) }))
    }
  }
  if (total.cacheHitRate !== undefined) {
    out.push(t('cost.hitRate', { value: formatPercent(total.cacheHitRate, locale()) }))
  }
  return out
}
