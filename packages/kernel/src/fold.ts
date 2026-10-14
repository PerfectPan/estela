import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { mainAgentId, promptStarts } from './lanes.ts'

export interface TraceFold extends SessionSummary {
  /** True when any event has `parentId`. */
  hasTree: boolean
  /** True when any event is shadowed. */
  hasShadowing: boolean
  /** Root-timeline events (no parentId), in log order. */
  roots: TraceEvent[]
}

/** Copy of the summary fields. Undefined capabilities are omitted. */
export function summaryOf(summary: SessionSummary): SessionSummary {
  const out: SessionSummary = {}
  if (summary.turns !== undefined) {
    out.turns = summary.turns
  }
  if (summary.requests !== undefined) {
    out.requests = summary.requests
  }
  if (summary.inputTokens !== undefined) {
    out.inputTokens = summary.inputTokens
  }
  if (summary.outputTokens !== undefined) {
    out.outputTokens = summary.outputTokens
  }
  if (summary.durationMs !== undefined) {
    out.durationMs = summary.durationMs
  }
  if (summary.compactions !== undefined) {
    out.compactions = summary.compactions
  }
  if (summary.subagents !== undefined) {
    out.subagents = summary.subagents
  }
  if (summary.failedTools !== undefined) {
    out.failedTools = summary.failedTools
  }
  if (summary.contextShape !== undefined) {
    out.contextShape = summary.contextShape
  }
  return out
}

export function downsample(values: number[], max = 120): number[] {
  if (values.length <= max) {
    return values.slice()
  }
  const out: number[] = []
  const last = values.length - 1
  for (let index = 0; index < max; index++) {
    out.push(values[Math.round((index * last) / (max - 1))]!)
  }
  return out
}

function gated(declared: boolean, value: number | undefined): number | undefined {
  if (!declared) {
    return undefined
  }
  return value
}

function usageSum(events: TraceEvent[], field: 'inputTokens' | 'outputTokens'): number | undefined {
  let total = 0
  let any = false
  for (const event of events) {
    if (event.kind !== 'request') {
      continue
    }
    const amount = event.payload.usage?.[field]
    if (amount === undefined) {
      continue
    }
    total += amount
    any = true
  }
  return any ? total : undefined
}

function knownSum(values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined)
  return known.length > 0 ? known.reduce((total, value) => total + value, 0) : undefined
}

/**
 * Turn durations (`system` events with `type: 'turn_duration'`) when the agent
 * records them; otherwise the sum of per-call request `durationMs`.
 */
function durationSum(events: TraceEvent[]): number | undefined {
  const turns: (number | undefined)[] = []
  const requests: (number | undefined)[] = []
  for (const event of events) {
    if (event.kind === 'system' && event.payload.type === 'turn_duration') {
      turns.push(event.payload.durationMs)
    } else if (event.kind === 'request') {
      requests.push(event.payload.durationMs)
    }
  }
  return knownSum(turns) ?? knownSum(requests)
}

/**
 * A turn is one real user prompt on the main lane (`isPrompt`), counted once per
 * log record: several `user` events from one record (content blocks) count once.
 */
function countTurns(trace: Trace): number {
  return promptStarts(trace, mainAgentId(trace)).length
}

export function fold(trace: Trace): TraceFold {
  const capabilities = new Set(trace.capabilities)
  const turns = countTurns(trace)
  const requestEvents = trace.events.filter(event => event.kind === 'request')
  const inputPoints = requestEvents.flatMap(event => {
    const input = event.payload.usage?.inputTokens
    return input === undefined ? [] : [input]
  })
  const usage = capabilities.has('usage')
  return {
    hasTree: trace.events.some(event => event.parentId != null),
    hasShadowing: trace.events.some(event => event.shadowedBy != null),
    roots: trace.events.filter(event => event.parentId == null),
    turns,
    requests: gated(capabilities.has('requests'), requestEvents.length),
    inputTokens: gated(usage, usageSum(trace.events, 'inputTokens')),
    outputTokens: gated(usage, usageSum(trace.events, 'outputTokens')),
    durationMs: gated(capabilities.has('durations'), durationSum(trace.events)),
    compactions: gated(
      capabilities.has('compaction'),
      trace.events.filter(event => event.kind === 'compaction').length,
    ),
    subagents: gated(capabilities.has('subagents'), trace.agents.filter(agent => agent.parentId != null).length),
    failedTools: trace.events.filter(event => event.kind === 'tool_result' && event.payload.isError === true).length,
    contextShape: usage && inputPoints.length > 0 ? downsample(inputPoints) : undefined,
  }
}
