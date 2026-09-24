import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { SessionSummary } from './host.ts'
import { asNumber, asRecord } from './jsonl.ts'

export interface TraceFold extends SessionSummary {
  /** True when any event has `parentId`. */
  hasTree: boolean
  /** True when any event is shadowed. */
  hasShadowing: boolean
  /** Root-timeline events (no parentId), in log order. */
  roots: TraceEvent[]
}

/** Copy of the summary fields. Undefined capabilities are omitted. */
export function summaryOf(fold: SessionSummary): SessionSummary {
  const out: SessionSummary = {}
  if (fold.turns !== undefined)
    out.turns = fold.turns
  if (fold.requests !== undefined)
    out.requests = fold.requests
  if (fold.tokensIn !== undefined)
    out.tokensIn = fold.tokensIn
  if (fold.tokensOut !== undefined)
    out.tokensOut = fold.tokensOut
  if (fold.durationMs !== undefined)
    out.durationMs = fold.durationMs
  if (fold.compactions !== undefined)
    out.compactions = fold.compactions
  if (fold.subagents !== undefined)
    out.subagents = fold.subagents
  if (fold.failedTools !== undefined)
    out.failedTools = fold.failedTools
  if (fold.contextShape !== undefined)
    out.contextShape = fold.contextShape
  return out
}

export function downsample(values: number[], max = 120): number[] {
  if (values.length <= max)
    return values.slice()
  const out: number[] = []
  const last = values.length - 1
  for (let index = 0; index < max; index++)
    out.push(values[Math.round((index * last) / (max - 1))]!)
  return out
}

function gated(declared: boolean, value: number | undefined): number | undefined {
  if (!declared)
    return undefined
  return value
}

function usageSum(events: TraceEvent[], field: 'inputTokens' | 'outputTokens'): number | undefined {
  let total = 0
  let any = false
  for (const event of events) {
    if (event.kind !== 'request')
      continue
    const amount = asNumber(asRecord(event.payload.usage)?.[field])
    if (amount === undefined)
      continue
    total += amount
    any = true
  }
  return any ? total : undefined
}

function durationSum(events: TraceEvent[]): number | undefined {
  let total = 0
  let any = false
  for (const event of events) {
    if (event.kind !== 'request')
      continue
    const amount = asNumber(event.payload.durationMs)
    if (amount === undefined)
      continue
    total += amount
    any = true
  }
  return any ? total : undefined
}

export function fold(trace: Trace): TraceFold {
  const capabilities = new Set(trace.capabilities)
  const main = trace.agents.find(agent => agent.parentId == null)?.id
  const turns = trace.events.filter(event =>
    event.kind === 'user' && (event.agentId == null || event.agentId === main),
  ).length
  const requestEvents = trace.events.filter(event => event.kind === 'request')
  const inputPoints = requestEvents.flatMap((event) => {
    const input = asNumber(asRecord(event.payload.usage)?.inputTokens)
    return input === undefined ? [] : [input]
  })
  const usage = capabilities.has('usage')
  return {
    hasTree: trace.events.some(event => event.parentId != null),
    hasShadowing: trace.events.some(event => event.shadowedBy != null),
    roots: trace.events.filter(event => event.parentId == null),
    turns,
    requests: gated(capabilities.has('requests'), requestEvents.length),
    tokensIn: gated(usage, usageSum(trace.events, 'inputTokens')),
    tokensOut: gated(usage, usageSum(trace.events, 'outputTokens')),
    durationMs: gated(capabilities.has('durations'), durationSum(trace.events)),
    compactions: gated(
      capabilities.has('compaction'),
      trace.events.filter(event => event.kind === 'compaction').length,
    ),
    subagents: gated(
      capabilities.has('subagents'),
      trace.agents.filter(agent => agent.parentId != null).length,
    ),
    failedTools: trace.events.filter(event => event.kind === 'tool_result' && event.payload.isError === true).length,
    contextShape: usage && inputPoints.length > 0 ? downsample(inputPoints) : undefined,
  }
}
