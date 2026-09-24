import type { AgentInfo, RequestPayload, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { ParsedSession, SourcedRecord } from '@rivus/agent-trace-kernel'
import {
  asNumber,
  asRecord,
  asString,
  assignSeq,
  baseEvent,
  generationError,
  inheritTimes,
  lineId,
  markOrphanToolResults,
  placeRequest,
  shadowBefore,
  skipRecord,
  timeOf,
  usageFrom,
} from '@rivus/agent-trace-kernel'

const HOST = 'grok'
const HOOK_OUTPUT_MAX = 240
/** Grok's per-update metadata key (`promptIndex`, `modelId`, `hideFromScrollback`). */
export const META_KEY = '_meta'

const BOOKKEEPING = new Set([
  'background_tasks',
  'task_backgrounded',
  'task_completed',
  'session_recap',
  'retry_state',
  'plan',
  'image_compressed',
])

/** Host status updates kept as `system` events with their `type`. */
const STATUS = new Set(['goal_updated', 'memory_dream_queued', 'memory_dream_started', 'memory_dream_completed'])

export interface GrokSessionMeta {
  id?: string
  title?: string
  cwd?: string
  startedAt?: number
  endedAt?: number
  model?: string
  systemPrompt?: string
  tools?: unknown
  version?: string
}

export function chunkText(content: unknown): string {
  const rec = asRecord(content)
  if (asString(rec?.text))
    return asString(rec?.text) ?? ''
  if (typeof content === 'string')
    return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      const inner = asRecord(part)
      const nested = asRecord(inner?.content)
      return asString(nested?.text) ?? asString(inner?.text) ?? ''
    }).join('')
  }
  return ''
}

/** Grok `inputTokens` already includes cached input (`cachedReadTokens` ≤ `inputTokens`, `totalTokens` = input + output). */
function usageOf(raw: Record<string, unknown> | undefined): RequestPayload['usage'] | undefined {
  if (!raw)
    return undefined
  return usageFrom({
    input: asNumber(raw.inputTokens),
    output: asNumber(raw.outputTokens),
    cacheRead: asNumber(raw.cachedReadTokens),
    cacheWrite: asNumber(raw.cacheCreationTokens),
    reasoning: asNumber(raw.reasoningTokens),
  })
}

/** Shared by discover and load. `chat_format_version` other than 1 fails the load. */
export function summaryFields(value: unknown, file: string): GrokSessionMeta {
  const summary = asRecord(value) ?? {}
  const format = asNumber(summary.chat_format_version)
  if (format !== undefined && format !== 1)
    throw generationError(HOST, file, 1)
  const info = asRecord(summary.info)
  return {
    id: asString(info?.id),
    cwd: asString(info?.cwd),
    title: asString(summary.generated_title) ?? asString(summary.session_summary),
    startedAt: timeOf(summary.created_at),
    endedAt: timeOf(summary.last_active_at),
    model: asString(summary.current_model_id),
  }
}

function hookRuns(runs: unknown): Record<string, unknown>[] {
  if (!Array.isArray(runs))
    return []
  return runs.flatMap((item) => {
    const run = asRecord(item)
    if (!run)
      return []
    const status = asRecord(run.status)
    const body: Record<string, unknown> = {}
    const name = asString(run.name)
    const state = asString(status?.status)
    const elapsedMs = asNumber(status?.elapsed_ms)
    const exitCode = asNumber(run.exit_code ?? status?.exit_code)
    const output = asString(run.output ?? status?.output)
    if (name)
      body.name = name
    if (state)
      body.status = state
    if (elapsedMs !== undefined)
      body.elapsedMs = elapsedMs
    if (exitCode !== undefined)
      body.exitCode = exitCode
    if (output)
      body.output = output.slice(0, HOOK_OUTPUT_MAX)
    return [body]
  })
}

/** `auto_compact_started` is skipped when an `auto_compact_completed` follows it. */
function completedLater(records: SourcedRecord[]): boolean[] {
  const out = Array.from({ length: records.length }, () => false)
  let seen = false
  for (let index = records.length - 1; index >= 0; index--) {
    out[index] = seen
    const update = asRecord(asRecord(asRecord(records[index]!.value)?.params)?.update)
    if (update?.sessionUpdate === 'auto_compact_completed')
      seen = true
  }
  return out
}

/**
 * Grok writes usage once per turn: `turn_completed.usage` sums the turn's model
 * calls (`modelCalls`, `numTurns` are counts; `modelUsage` is per model), and no
 * per-call record exists. So a `request` here is one turn, not one model call.
 * `elapsed_ms` is the turn duration and goes on a `turn_duration` marker.
 */
export function parseGrokRecords(records: SourcedRecord[], meta: GrokSessionMeta = {}): ParsedSession {
  const events: TraceEvent[] = []
  const skipped: Trace['skipped'] = []
  const agents: AgentInfo[] = [{ id: 'main' }]
  const times = inheritTimes(records)
  const compactDone = completedLater(records)
  let prompt: string | undefined
  let lastUserPrompt: string | undefined
  let model = meta.model
  let startedAt = meta.startedAt
  let endedAt = meta.endedAt
  let segment = 0

  const rememberAgent = (id: string, title?: string, spawnEventId?: string): void => {
    const existing = agents.find(agent => agent.id === id)
    if (!existing) {
      agents.push({ id, parentId: 'main', ...(title ? { title } : {}), ...(spawnEventId ? { spawnEventId } : {}) })
      return
    }
    if (!existing.title && title)
      existing.title = title
    if (!existing.spawnEventId && spawnEventId)
      existing.spawnEventId = spawnEventId
  }

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    const ts = times[index]!
    const rec = asRecord(record.value)
    const update = asRecord(asRecord(rec?.params)?.update) ?? asRecord(rec?.update)
    if (!rec || !update || 'formatVersion' in rec || 'formatVersion' in update)
      throw generationError(HOST, record.file, record.line)
    const schemaVersion = asNumber(update.schema_version)
    if (schemaVersion !== undefined && schemaVersion !== 1)
      throw generationError(HOST, record.file, record.line)

    const kind = asString(update.sessionUpdate) ?? 'update'
    startedAt = Math.min(startedAt ?? ts, ts)
    endedAt = Math.max(endedAt ?? ts, ts)
    const updateMeta = asRecord(update[META_KEY])
    const promptIndex = asNumber(updateMeta?.promptIndex)
    if (promptIndex !== undefined)
      prompt = String(promptIndex)
    model = asString(updateMeta?.modelId) ?? model
    const emit = (eventKind: TraceEvent['kind'], payload: Record<string, unknown>, id?: string): TraceEvent => {
      const event = baseEvent(record, eventKind, payload, { id: id ?? lineId(record), ts })
      events.push(event)
      return event
    }

    if (kind === 'user_message_chunk' || kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const text = chunkText(update.content)
      if (kind !== 'user_message_chunk') {
        emit(kind === 'agent_thought_chunk' ? 'thinking' : 'assistant', text ? { text } : {})
        continue
      }
      const flags: Record<string, unknown> = {}
      if (updateMeta?.hideFromScrollback === true)
        flags.injected = true
      if (prompt !== undefined && prompt === lastUserPrompt)
        flags.continued = true
      lastUserPrompt = prompt
      emit('user', { ...flags, ...(text ? { text } : {}) })
      continue
    }

    if (kind === 'tool_call') {
      const payload: Record<string, unknown> = {
        callId: asString(update.toolCallId) ?? '',
        name: asString(update.title) ?? asString(update.toolName) ?? '',
      }
      if (update.rawInput !== undefined)
        payload.args = update.rawInput
      emit('tool_call', payload)
      continue
    }

    if (kind === 'tool_call_update') {
      const status = asString(update.status) ?? ''
      if (status !== 'completed' && status !== 'failed' && status !== 'error') {
        skipRecord(skipped, record, 'tool-progress')
        continue
      }
      const payload: Record<string, unknown> = { callId: asString(update.toolCallId) ?? '', isError: status !== 'completed' }
      const output = update.content !== undefined ? (chunkText(update.content) || update.content) : update.rawOutput
      if (output !== undefined)
        payload.output = output
      emit('tool_result', payload)
      continue
    }

    if (kind === 'turn_completed') {
      const key = prompt ?? asString(update.prompt_id) ?? lineId(record)
      const id = events.some(event => event.id === `request:${key}`) ? `request:${lineId(record)}` : `request:${key}`
      const usageRaw = asRecord(update.usage)
      const models = Object.keys(asRecord(usageRaw?.modelUsage) ?? {})
      const payload: Record<string, unknown> = {}
      const requestModel = model ?? (models.length === 1 ? models[0] : undefined)
      if (requestModel)
        payload.model = requestModel
      const usage = usageOf(usageRaw)
      if (usage)
        payload.usage = usage
      const stop = asString(update.stop_reason)
      if (stop)
        payload.stopReason = stop
      segment = placeRequest(events, segment, baseEvent(record, 'request', payload, { id, ts, requestId: key }))
      const durationMs = asNumber(update.elapsed_ms)
      if (durationMs !== undefined)
        emit('system', { type: 'turn_duration', durationMs })
      segment = events.length
      continue
    }

    if (kind === 'hook_execution') {
      const eventName = asString(update.event_name)
      const toolName = asString(update.tool_name)
      emit('hook', {
        type: 'hook_execution',
        ...(eventName ? { event_name: eventName } : {}),
        ...(toolName ? { tool_name: toolName } : {}),
        runs: hookRuns(update.runs),
      })
      continue
    }

    if (kind === 'auto_compact_started' && compactDone[index]) {
      skipRecord(skipped, record, 'compact-started')
      continue
    }
    if (kind === 'auto_compact_completed' || kind === 'auto_compact_started') {
      const pre = asNumber(update.tokens_before ?? update.tokens_used)
      const post = asNumber(update.tokens_after)
      emit('compaction', {
        trigger: 'auto',
        ...(pre !== undefined ? { preTokens: pre } : {}),
        ...(post !== undefined ? { postTokens: post } : {}),
      })
      continue
    }

    if (kind === 'compaction_checkpoint') {
      skipRecord(skipped, record, 'compaction-checkpoint')
      continue
    }

    if (kind === 'subagent_spawned' || kind === 'subagent_finished') {
      const agentId = asString(update.subagent_id) ?? asString(update.child_session_id)
      const status = asString(update.status)
      const durationMs = asNumber(update.duration_ms)
      const event = emit('system', {
        type: kind,
        ...(agentId ? { agentId } : {}),
        ...(status ? { status } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      })
      if (agentId)
        rememberAgent(agentId, asString(update.description), kind === 'subagent_spawned' ? event.id : undefined)
      continue
    }

    if (STATUS.has(kind)) {
      const status = asString(update.status)
      const phase = asString(update.phase)
      emit('system', { type: kind, ...(status ? { status } : {}), ...(phase ? { phase } : {}) })
      continue
    }

    if (BOOKKEEPING.has(kind)) {
      skipRecord(skipped, record, kind)
      continue
    }

    emit('unknown', { type: kind })
  }

  for (const compaction of events) {
    if (compaction.kind === 'compaction')
      shadowBefore(events, compaction)
  }
  markOrphanToolResults(events)
  assignSeq(events)
  return {
    events,
    skipped,
    version: meta.version,
    agents,
    session: {
      id: meta.id ?? 'unknown',
      ...(meta.title ? { title: meta.title } : {}),
      ...(meta.cwd ? { cwd: meta.cwd } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(endedAt !== undefined ? { endedAt } : {}),
      ...(meta.systemPrompt ? { systemPrompt: meta.systemPrompt } : {}),
      ...(meta.tools !== undefined ? { tools: meta.tools } : {}),
    },
  }
}
