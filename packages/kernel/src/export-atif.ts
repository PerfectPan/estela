import type { EventOf, Trace, TraceEvent } from '@rivus/estela-schema'
import { isPlainObject } from 'es-toolkit'
import { laneIds, laneOf, mainAgentId, shadowedIn } from './lanes.ts'
import { priceTrace, type CostTotal, type TraceCost, type TracePricing } from './price-trace.ts'
import { promptSnapshot } from './prompt-snapshot.ts'
import {
  agentKind,
  attachExtras,
  attachSideEvent,
  compactionDraft,
  snapshotText,
  stepOf,
  systemDraft,
  toolArguments,
  toolResult,
  userFlags,
  type StepDraft,
  type TraceExtras,
  type TrajectoryBuild,
} from './export-atif-steps.ts'

/** ATIF version this projection targets (Harbor RFC 0001); the mapping is listed in `docs/reference/export-formats.md`. */
export const ATIF_SCHEMA_VERSION = 'ATIF-v1.8' as const

export interface AtifAgent {
  name: string
  version: string
  model_name?: string
  tool_definitions?: Record<string, unknown>[]
}

export interface AtifToolCall {
  tool_call_id: string
  function_name: string
  arguments: Record<string, unknown>
  extra?: { estela?: { title?: string } }
}

export interface AtifSubagentRef {
  trajectory_id: string
  trajectory_path?: string
  session_id?: string
}

export interface AtifObservationResult {
  source_call_id?: string
  content?: string
  subagent_trajectory_ref?: AtifSubagentRef[]
  extra?: { estela?: { isError?: boolean; exitCode?: number; orphan?: boolean } }
}

export interface AtifObservation {
  results: AtifObservationResult[]
}

/** The counts ATIF has a field for, and the rest under `extra.estela`. */
export interface AtifMetrics {
  prompt_tokens?: number
  completion_tokens?: number
  cached_tokens?: number
  /** The step's request at the export's price table; absent when unpriced or exported without prices. */
  cost_usd?: number
  extra?: {
    estela?: {
      responseId?: string
      modelCalls?: number
      granularity?: string
      totalTokens?: number
      cacheWriteTokens?: number
      cacheWrite1hTokens?: number
      reasoningTokens?: number
    }
  }
}

export interface AtifStep {
  step_id: number
  timestamp?: string
  source: 'system' | 'user' | 'agent'
  model_name?: string
  message: string
  reasoning_content?: string
  tool_calls?: AtifToolCall[]
  observation?: AtifObservation
  metrics?: AtifMetrics
  is_copied_context?: boolean
  llm_call_count?: number
  extra?: { context_management?: { type: string; boundary: string }; estela?: TraceExtras }
}

export interface AtifFinalMetrics {
  total_prompt_tokens?: number
  total_completion_tokens?: number
  total_cached_tokens?: number
  /** Only when every request of the trajectory, subagents included, is priced: a partial sum is not a total. */
  total_cost_usd?: number
  total_steps?: number
}

export interface AtifTrajectory {
  schema_version: typeof ATIF_SCHEMA_VERSION
  session_id?: string
  trajectory_id?: string
  agent: AtifAgent
  steps: AtifStep[]
  notes?: string
  final_metrics?: AtifFinalMetrics
  extra?: {
    estela?: {
      capabilities?: string[]
      skipped?: { reason: string; count: number }[]
      hooks?: Record<string, unknown>[]
      unknown?: { type: string }[]
      turnDurationsMs?: number[]
      snapshotEventIds?: string[]
      /** The price table behind every `cost_usd`, and how many exported requests it could not price. */
      pricing?: { version: string; unpricedRequests: number }
    }
  }
  subagent_trajectories?: AtifTrajectory[]
}

/** ATIF's `tool_definitions` holds a list of objects: anything else stays out. */
function toolDefinitions(tools: unknown): { tool_definitions?: Record<string, unknown>[] } {
  if (!Array.isArray(tools) || tools.length === 0 || !tools.every(isPlainObject)) {
    return {}
  }
  return { tool_definitions: tools }
}

function skippedOf(trace: Trace): { reason: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const entry of trace.skipped) {
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1)
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count }))
}

function finalMetrics(steps: AtifStep[]): AtifFinalMetrics {
  let prompt: number | undefined
  let completion: number | undefined
  let cached: number | undefined
  for (const step of steps) {
    if (step.metrics?.prompt_tokens !== undefined) {
      prompt = (prompt ?? 0) + step.metrics.prompt_tokens
    }
    if (step.metrics?.completion_tokens !== undefined) {
      completion = (completion ?? 0) + step.metrics.completion_tokens
    }
    if (step.metrics?.cached_tokens !== undefined) {
      cached = (cached ?? 0) + step.metrics.cached_tokens
    }
  }
  return {
    ...(prompt !== undefined ? { total_prompt_tokens: prompt } : {}),
    ...(completion !== undefined ? { total_completion_tokens: completion } : {}),
    ...(cached !== undefined ? { total_cached_tokens: cached } : {}),
    total_steps: steps.length,
  }
}

/**
 * A `system` event: a prompt snapshot becomes a system step when its text is new; a text
 * instruction becomes one; a turn duration, hook, or unknown payload attaches to the open
 * step's or the root's extras.
 */
function systemEvent(
  build: TrajectoryBuild,
  open: StepDraft | undefined,
  event: EventOf<'system'>,
  state: { lastSystemText: string | undefined; byId: Map<string, TraceEvent> },
): { open: StepDraft | undefined; lastSystemText: string | undefined } {
  const snapshot = promptSnapshot(event)
  if (snapshot !== undefined) {
    const text = snapshotText(snapshot, state.byId)
    if (text !== undefined && text !== state.lastSystemText) {
      state.lastSystemText = text
      build.drafts.push(systemDraft(text, { eventIds: [event.id] }))
      return { open: undefined, lastSystemText: text }
    }
    attachExtras(build, open, { snapshotEventIds: [event.id] })
    return { open, lastSystemText: state.lastSystemText }
  }
  const text = typeof event.payload.text === 'string' ? event.payload.text : undefined
  if (text !== undefined) {
    build.drafts.push(
      systemDraft(
        text,
        event.payload.type !== undefined
          ? { eventIds: [event.id], systemType: event.payload.type }
          : { eventIds: [event.id] },
      ),
    )
    return { open: undefined, lastSystemText: text }
  }
  if (event.payload.type === 'turn_duration' && event.payload.durationMs !== undefined) {
    attachExtras(build, open, { turnDurationMs: event.payload.durationMs })
    return { open, lastSystemText: state.lastSystemText }
  }
  attachExtras(build, open, { unknown: [{ type: event.payload.type ?? 'system' }] })
  return { open, lastSystemText: state.lastSystemText }
}

/** Every lane spawned by an event gets one ref on the step holding that event. */
function attachSpawnRefs(trace: Trace, builds: Map<string, TrajectoryBuild>, embedded: Set<string>): void {
  for (const lane of trace.agents) {
    if (lane.parentId === undefined || lane.spawnEventId === undefined || !embedded.has(lane.id)) {
      continue
    }
    const spawnEventId = lane.spawnEventId
    const draft = [...builds.values()]
      .flatMap(build => build.drafts)
      .find(candidate => candidate.events.some(event => event.id === spawnEventId))
    if (draft === undefined) {
      continue
    }
    const spawnEvent = draft.events.find(event => event.id === spawnEventId)!
    draft.results.push({
      ...(spawnEvent.kind === 'tool_call' ? { source_call_id: spawnEvent.payload.callId } : {}),
      subagent_trajectory_ref: [{ trajectory_id: lane.id, session_id: trace.session.id }],
    })
  }
}

/**
 * One lane's walk in `seq` order: user and compaction events, and system events that become a
 * step, close the open agent step, agent-kind events join or open the step of their `requestId`, and a
 * `tool_result` follows its `tool_call`'s step.
 */
function buildLane(
  trace: Trace,
  laneId: string,
  mainId: string,
  hidden: Set<string>,
  byId: Map<string, TraceEvent>,
): TrajectoryBuild {
  const build: TrajectoryBuild = { drafts: [], laneCompactionSeqs: [], rootExtras: {} }
  let open: StepDraft | undefined
  let lastSystemText: string | undefined
  const lane = trace.agents.find(agent => agent.id === laneId)

  const openAgent = (requestId: string | undefined): StepDraft => {
    const fresh: StepDraft = {
      source: 'agent',
      events: [],
      texts: [],
      reasoning: [],
      toolCalls: [],
      callIds: new Set<string>(),
      results: [],
      extras: requestId !== undefined ? { eventIds: [], requestId } : { eventIds: [] },
    }
    build.drafts.push(fresh)
    return fresh
  }

  const initialPrompt = laneId === mainId ? trace.session.systemPrompt : lane?.systemPrompt
  if (initialPrompt !== undefined && initialPrompt.length > 0) {
    lastSystemText = initialPrompt
    build.drafts.push(systemDraft(initialPrompt, { eventIds: [] }))
  }

  for (const event of trace.events) {
    if (laneOf(event, mainId) !== laneId || hidden.has(event.id)) {
      continue
    }
    if (event.kind === 'user') {
      open = undefined
      const flags = userFlags(event)
      build.drafts.push({
        source: 'user',
        events: [event],
        texts: [typeof event.payload.text === 'string' ? event.payload.text : ''],
        reasoning: [],
        toolCalls: [],
        callIds: new Set<string>(),
        results: [],
        extras: flags.length > 0 ? { eventIds: [event.id], flags } : { eventIds: [event.id] },
      })
      continue
    }
    if (event.kind === 'system') {
      const handled = systemEvent(build, open, event, { lastSystemText, byId })
      open = handled.open
      lastSystemText = handled.lastSystemText
      continue
    }
    if (event.kind === 'compaction') {
      open = undefined
      build.laneCompactionSeqs.push(event.seq)
      build.drafts.push(compactionDraft(event, byId))
      continue
    }
    if (!agentKind(event)) {
      attachSideEvent(build, open, event)
      continue
    }
    if (event.kind === 'tool_result') {
      open = toolResult(build, open, event)
      continue
    }
    if (open === undefined) {
      open = openAgent(event.requestId)
    } else if (open.extras.requestId !== event.requestId) {
      // A group key adopts an open step that has none, so ungrouped events before the
      // request record stay one turn with the request and assistant events that follow.
      if (open.extras.requestId === undefined && event.requestId !== undefined) {
        open.extras.requestId = event.requestId
      } else {
        open = openAgent(event.requestId)
      }
    }
    open.events.push(event)
    open.extras.eventIds.push(event.id)
    if (event.kind === 'request') {
      open.request = event
      continue
    }
    if (event.kind === 'assistant' && typeof event.payload.text === 'string') {
      open.texts.push(event.payload.text)
      continue
    }
    if (event.kind === 'reasoning' && typeof event.payload.text === 'string') {
      open.reasoning.push(event.payload.text)
      continue
    }
    if (event.kind === 'tool_call') {
      open.toolCalls.push({
        tool_call_id: event.payload.callId,
        function_name: event.payload.name,
        arguments: toolArguments(event.payload.args),
        ...(event.payload.title !== undefined ? { extra: { estela: { title: event.payload.title } } } : {}),
      })
      open.callIds.add(event.payload.callId)
    }
  }
  return build
}

function finishTrajectory(
  trace: Trace,
  build: TrajectoryBuild,
  laneId: string,
  embedded: boolean,
  /**
   * The trace's prices and the total this trajectory reports: its lane's, or for the root the whole trace's (ATIF's
   * root total includes subagents). Totals count every request of the lane, also those a compaction hid, which
   * produce no step, so a total is never complete while a hidden request is unpriced.
   */
  cost?: { trace: TraceCost; total: CostTotal | undefined },
): AtifTrajectory {
  const mainId = mainAgentId(trace)
  if (build.drafts.length === 0) {
    const prompt = laneId === mainId ? trace.session.systemPrompt : undefined
    if (prompt === undefined) {
      throw new Error(
        'No events an ATIF step can come from: the trace records no user, agent, or system-prompt content',
      )
    }
    build.drafts.push(systemDraft(prompt, { eventIds: [] }))
  }
  const models = new Set(
    build.drafts.flatMap(draft => (draft.request?.payload.model !== undefined ? [draft.request.payload.model] : [])),
  )
  const agent: AtifAgent = {
    name: trace.agent,
    version: trace.agentVersion ?? 'unknown',
    ...(models.size === 1 ? { model_name: [...models][0] } : {}),
    ...(laneId === mainId ? toolDefinitions(trace.session.tools) : {}),
  }
  const priced = (draft: StepDraft) => {
    const request = draft.request ? cost?.trace.requests.get(draft.request.id) : undefined
    return request?.kind === 'priced' ? request.usd : undefined
  }
  const steps = build.drafts.map((draft, index) =>
    stepOf(draft, index + 1, build.laneCompactionSeqs, agent.model_name, priced(draft)),
  )
  const metrics = finalMetrics(steps)
  const total = cost?.total
  if (total?.usd !== undefined && total.priced === total.requests) {
    metrics.total_cost_usd = total.usd
  }
  return {
    schema_version: ATIF_SCHEMA_VERSION,
    session_id: trace.session.id,
    ...(embedded ? { trajectory_id: laneId } : {}),
    agent,
    steps,
    notes:
      'Exported from an Estela canonical trace (https://github.com/PerfectPan/estela). '
      + 'Each step lists its canonical event ids in extra.estela.eventIds. Events a compaction '
      + 'removed are not steps; steps kept across a compaction boundary are marked is_copied_context.'
      + (cost
        ? ' cost_usd is the list price of the recorded tokens at the price table extra.estela.pricing names '
          + '(on the root trajectory), not an amount billed; total_cost_usd appears only when every request is priced.'
        : ''),
    final_metrics: metrics,
    ...(laneId === mainId
      ? {
          extra: {
            estela: {
              capabilities: [...trace.capabilities],
              skipped: skippedOf(trace),
              ...build.rootExtras,
              ...(cost
                ? {
                    pricing: {
                      version: cost.trace.version,
                      unpricedRequests: (total?.requests ?? 0) - (total?.priced ?? 0),
                    },
                  }
                : {}),
            },
          },
        }
      : {}),
  }
}

/**
 * The canonical trace as one ATIF v1.8 trajectory (Harbor RFC 0001), the mapping in
 * `docs/reference/export-formats.md`: one step per user event, per `requestId` group on a lane, and
 * per compaction; each subagent lane embedded as its own trajectory; fields ATIF has no
 * place for in `extra`. Events a compaction removed produce no step.
 */
export function toAtif(trace: Trace, options: { pricing?: TracePricing } = {}): AtifTrajectory {
  const mainId = mainAgentId(trace)
  const hidden = shadowedIn(trace.events)
  const byId = new Map(trace.events.map(event => [event.id, event]))
  const laneIdsList = laneIds(trace)
  const builds = new Map<string, TrajectoryBuild>()
  for (const laneId of laneIdsList) {
    builds.set(laneId, buildLane(trace, laneId, mainId, hidden, byId))
  }
  // A subagent lane the log records nothing on exports as nothing: no embedded
  // trajectory, and its spawn step carries no ref, so every ref stays resolvable.
  const embedded = new Set<string>()
  const subagents: AtifTrajectory[] = []
  const traceCost = options.pricing ? priceTrace(trace, options.pricing) : undefined
  const laneCost = (laneId: string) =>
    traceCost ? { trace: traceCost, total: traceCost.lanes.get(laneId) } : undefined
  for (const laneId of laneIdsList) {
    if (laneId !== mainId && builds.get(laneId)!.drafts.length > 0) {
      embedded.add(laneId)
      subagents.push(finishTrajectory(trace, builds.get(laneId)!, laneId, true, laneCost(laneId)))
    }
  }
  attachSpawnRefs(trace, builds, embedded)

  const rootTrajectory = finishTrajectory(
    trace,
    builds.get(mainId)!,
    mainId,
    false,
    traceCost ? { trace: traceCost, total: traceCost.total } : undefined,
  )
  if (subagents.length > 0) {
    rootTrajectory.subagent_trajectories = subagents
  }
  return rootTrajectory
}
