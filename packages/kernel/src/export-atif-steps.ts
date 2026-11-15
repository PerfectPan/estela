import { isPlainObject } from 'es-toolkit'
import type { EventOf, TraceEvent } from '@rivus/estela-schema'
import { promptSnapshot } from './prompt-snapshot.ts'
import type { AtifMetrics, AtifObservationResult, AtifStep, AtifToolCall } from './export-atif.ts'

/** ATIF has no place for these outside `extra`; a step or the root trajectory holds them. */
export interface TraceExtras {
  eventIds: string[]
  requestId?: string
  flags?: string[]
  hooks?: Record<string, unknown>[]
  unknown?: { type: string }[]
  turnDurationMs?: number
  turnDurationsMs?: number[]
  snapshotEventIds?: string[]
  compaction?: { trigger?: string; preTokens?: number; postTokens?: number }
  systemType?: string
}

/** One step under construction: the events it covers and the ATIF fields they map to. */
export interface StepDraft {
  source: 'system' | 'user' | 'agent'
  events: TraceEvent[]
  texts: string[]
  reasoning: string[]
  toolCalls: AtifToolCall[]
  callIds: Set<string>
  results: AtifObservationResult[]
  request?: EventOf<'request'>
  extras: TraceExtras
}

/** Per-lane walk state: the drafts in order, the lane's compaction points, root-level extras. */
export interface TrajectoryBuild {
  drafts: StepDraft[]
  laneCompactionSeqs: number[]
  rootExtras: Pick<TraceExtras, 'hooks' | 'unknown' | 'turnDurationsMs' | 'snapshotEventIds'>
}

const COMPACTION_MESSAGE = 'Context compaction performed'

export function agentKind(event: TraceEvent): boolean {
  return (
    event.kind === 'assistant'
    || event.kind === 'reasoning'
    || event.kind === 'tool_call'
    || event.kind === 'tool_result'
    || event.kind === 'request'
  )
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** `arguments` must be a JSON object; anything else wraps, so no argument data is lost. */
export function toolArguments(args: unknown): Record<string, unknown> {
  if (args === undefined) {
    return {}
  }
  return isPlainObject(args) ? args : { input: args }
}

/** Tool output becomes string content: text as is, anything else as its JSON. */
function resultContent(output: unknown): string | undefined {
  if (output === undefined) {
    return undefined
  }
  return typeof output === 'string' ? output : JSON.stringify(output)
}

function joined(parts: string[]): string | undefined {
  const text = parts.filter(part => part.length > 0).join('\n\n')
  return text.length > 0 ? text : undefined
}

export function systemDraft(message: string, extras: TraceExtras): StepDraft {
  return {
    source: 'system',
    events: [],
    texts: [message],
    reasoning: [],
    toolCalls: [],
    callIds: new Set<string>(),
    results: [],
    extras: { ...extras, eventIds: [...extras.eventIds] },
  }
}

export function userFlags(event: EventOf<'user'>): string[] {
  const payload = event.payload
  return (['meta', 'compactSummary', 'command', 'injected', 'continued'] as const).filter(
    flag => payload[flag] === true,
  )
}

/**
 * A snapshot's own text, or the text of the snapshot a view-trace reference names, so an
 * export of a view trace still resolves each prompt. `undefined` when it names no text.
 */
export function snapshotText(
  snapshot: NonNullable<ReturnType<typeof promptSnapshot>>,
  byId: Map<string, TraceEvent>,
): string | undefined {
  if (snapshot.systemPrompt !== undefined) {
    return snapshot.systemPrompt
  }
  const named = snapshot.systemPromptSameAs !== undefined ? byId.get(snapshot.systemPromptSameAs) : undefined
  return named === undefined ? undefined : promptSnapshot(named)?.systemPrompt
}

export function compactionDraft(event: EventOf<'compaction'>, byId: Map<string, TraceEvent>): StepDraft {
  const summary = event.payload.summaryEventId !== undefined ? byId.get(event.payload.summaryEventId) : undefined
  const summaryText = summary !== undefined && summary.kind === 'user' ? textOf(summary.payload.text) : undefined
  const message = summaryText ?? COMPACTION_MESSAGE
  const results: AtifObservationResult[] = summaryText !== undefined ? [{ content: summaryText }] : []
  const payload = event.payload
  const compaction: TraceExtras['compaction'] = {
    ...(payload.trigger !== undefined ? { trigger: payload.trigger } : {}),
    ...(payload.preTokens !== undefined ? { preTokens: payload.preTokens } : {}),
    ...(payload.postTokens !== undefined ? { postTokens: payload.postTokens } : {}),
  }
  return {
    source: 'system',
    events: [],
    texts: [message],
    reasoning: [],
    toolCalls: [],
    callIds: new Set<string>(),
    results,
    extras: {
      eventIds: [event.id],
      ...(Object.keys(compaction).length > 0 ? { compaction } : {}),
    },
  }
}

export function attachExtras(
  build: TrajectoryBuild,
  open: StepDraft | undefined,
  patch: Partial<Pick<TraceExtras, 'hooks' | 'unknown' | 'turnDurationMs' | 'snapshotEventIds'>>,
): void {
  const target = open !== undefined ? open.extras : build.rootExtras
  if (patch.hooks !== undefined) {
    target.hooks = [...(target.hooks ?? []), ...patch.hooks]
  }
  if (patch.unknown !== undefined) {
    target.unknown = [...(target.unknown ?? []), ...patch.unknown]
  }
  if (patch.turnDurationMs !== undefined) {
    if (open !== undefined) {
      open.extras.turnDurationMs = patch.turnDurationMs
    } else {
      build.rootExtras.turnDurationsMs = [...(build.rootExtras.turnDurationsMs ?? []), patch.turnDurationMs]
    }
  }
  if (patch.snapshotEventIds !== undefined) {
    target.snapshotEventIds = [...(target.snapshotEventIds ?? []), ...patch.snapshotEventIds]
  }
}

/** A `hook` or `unknown` event: collected into the open step's or the root's extras. */
export function attachSideEvent(build: TrajectoryBuild, open: StepDraft | undefined, event: TraceEvent): void {
  if (event.kind === 'hook') {
    attachExtras(build, open, { hooks: [event.payload] })
    return
  }
  const type = event.kind === 'unknown' ? event.payload.type : event.kind
  attachExtras(build, open, { unknown: [{ type }] })
}

/**
 * A `tool_result` joins the step that holds its `tool_call` when that step exists (the
 * validator requires `source_call_id` to resolve inside one step); otherwise it is an orphan
 * result on the current agent step, without a `source_call_id`.
 */
export function toolResult(
  build: TrajectoryBuild,
  open: StepDraft | undefined,
  event: EventOf<'tool_result'>,
): StepDraft | undefined {
  const callId = event.payload.callId
  const target = build.drafts.find(draft => draft.callIds.has(callId))
  const payload = event.payload
  const flagged = payload.isError !== undefined || payload.exitCode !== undefined || payload.orphan !== undefined
  const result: AtifObservationResult = {
    ...(target !== undefined ? { source_call_id: callId } : {}),
    ...(resultContent(payload.output) !== undefined ? { content: resultContent(payload.output) } : {}),
    ...(flagged
      ? {
          extra: {
            estela: {
              ...(payload.isError !== undefined ? { isError: payload.isError } : {}),
              ...(payload.exitCode !== undefined ? { exitCode: payload.exitCode } : {}),
              ...(payload.orphan !== undefined ? { orphan: payload.orphan } : {}),
            },
          },
        }
      : {}),
  }
  if (target !== undefined) {
    target.results.push(result)
    target.extras.eventIds.push(event.id)
    return open
  }
  if (open === undefined) {
    const fresh: StepDraft = {
      source: 'agent',
      events: [event],
      texts: [],
      reasoning: [],
      toolCalls: [],
      callIds: new Set<string>(),
      results: [result],
      extras: { eventIds: [event.id] },
    }
    build.drafts.push(fresh)
    return fresh
  }
  open.results.push(result)
  open.events.push(event)
  open.extras.eventIds.push(event.id)
  return open
}

/** `llm_call_count` records an aggregate the exporter cannot split: only from `modelCalls`. */
function llmCallCount(draft: StepDraft): number | undefined {
  const granularity = draft.request?.payload.granularity
  if (granularity !== 'turn' && granularity !== 'session') {
    return undefined
  }
  return draft.request?.payload.modelCalls
}

function metricsOf(request: EventOf<'request'> | undefined, costUsd: number | undefined): AtifMetrics | undefined {
  if (request === undefined) {
    return undefined
  }
  const usage = request.payload.usage
  const payload = request.payload
  const trace: NonNullable<AtifMetrics['extra']>['estela'] = {
    ...(payload.responseId !== undefined ? { responseId: payload.responseId } : {}),
    ...(payload.modelCalls !== undefined ? { modelCalls: payload.modelCalls } : {}),
    ...(payload.granularity !== undefined ? { granularity: payload.granularity } : {}),
    ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage?.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(usage?.cacheWrite1hTokens !== undefined ? { cacheWrite1hTokens: usage.cacheWrite1hTokens } : {}),
    ...(usage?.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
  }
  const hasCounts =
    usage?.inputTokens !== undefined || usage?.outputTokens !== undefined || usage?.cacheReadTokens !== undefined
  if (!hasCounts && Object.keys(trace).length === 0) {
    return undefined
  }
  return {
    ...(usage?.inputTokens !== undefined ? { prompt_tokens: usage.inputTokens } : {}),
    ...(usage?.outputTokens !== undefined ? { completion_tokens: usage.outputTokens } : {}),
    ...(usage?.cacheReadTokens !== undefined ? { cached_tokens: usage.cacheReadTokens } : {}),
    ...(costUsd !== undefined ? { cost_usd: costUsd } : {}),
    ...(Object.keys(trace).length > 0 ? { extra: { estela: trace } } : {}),
  }
}

function extraOf(draft: StepDraft): { extra: AtifStep['extra'] } | {} {
  const extras: TraceExtras = draft.extras
  const contextManagement =
    draft.extras.compaction !== undefined ? { type: 'compaction', boundary: 'replace' } : undefined
  if (Object.keys(extras).length === 0 && contextManagement === undefined) {
    return {}
  }
  return {
    extra: {
      ...(contextManagement !== undefined ? { context_management: contextManagement } : {}),
      estela: { ...extras },
    },
  }
}

/**
 * The ATIF step a draft becomes: ids, copied-context mark, metrics, and `extra`. `costUsd` is the price of the
 * step's request when the exporter was given a price table and the request is priced.
 */
export function stepOf(
  draft: StepDraft,
  stepId: number,
  compactionSeqs: number[],
  agentModel: string | undefined,
  costUsd?: number,
): AtifStep {
  const message = draft.texts.length > 0 ? draft.texts.join('\n\n') : ''
  const reasoning = joined(draft.reasoning)
  const lastSeq = draft.events.length > 0 ? Math.max(...draft.events.map(event => event.seq)) : -1
  const copied = draft.events.length > 0 && compactionSeqs.some(seq => seq > lastSeq)
  const metrics = metricsOf(draft.request, costUsd)
  const step: AtifStep = {
    step_id: stepId,
    ...(draft.events.length > 0 ? { timestamp: new Date(draft.events[0]!.ts).toISOString() } : {}),
    source: draft.source,
    ...(draft.request?.payload.model !== undefined && draft.request.payload.model !== agentModel
      ? { model_name: draft.request.payload.model }
      : {}),
    message,
    ...(reasoning !== undefined ? { reasoning_content: reasoning } : {}),
    ...(draft.toolCalls.length > 0 ? { tool_calls: draft.toolCalls } : {}),
    ...(draft.results.length > 0 ? { observation: { results: draft.results } } : {}),
    ...(metrics !== undefined ? { metrics } : {}),
    ...(copied ? { is_copied_context: true } : {}),
    ...(llmCallCount(draft) !== undefined ? { llm_call_count: llmCallCount(draft) } : {}),
    ...extraOf(draft),
  }
  return step
}
