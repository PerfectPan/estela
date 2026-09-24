import type { AgentInfo, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { ParsedSession, SourcedRecord } from '@rivus/agent-trace-kernel'
import {
  asNumber,
  asRecord,
  asString,
  assignSeq,
  baseEvent,
  generationError,
  inheritTimes,
  markOrphanToolResults,
  placeRequest,
  shadowBefore,
  skipRecord,
  usageFrom,
} from '@rivus/agent-trace-kernel'
import { emitInner, textFrom } from './codex-items.ts'

/**
 * Event id from the record's line. A Codex trace is one rollout file, so the
 * line alone is unique; the kernel's `lineId` would repeat the 70-character
 * rollout name on every event and request id (plan A.6).
 */
function lineKey(record: SourcedRecord): string {
  return `L${record.line}`
}

const HOST = 'codex'
const BARE_ITEM = new Set(['message', 'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output', 'compaction', 'agent_message', 'web_search_call'])

/** Per-call numbers: `token_usage_record.usage` or `token_count.info.last_token_usage`. `input_tokens` already includes cached input. */
function callUsage(raw: Record<string, unknown> | undefined) {
  if (!raw)
    return undefined
  return usageFrom({
    input: asNumber(raw.input_tokens),
    output: asNumber(raw.output_tokens),
    cacheRead: asNumber(raw.cached_input_tokens),
    cacheWrite: asNumber(raw.cache_write_input_tokens),
    reasoning: asNumber(raw.reasoning_output_tokens),
  })
}

function hostIds(event: TraceEvent): string[] {
  const payload = asRecord(asRecord(event.original)?.payload) ?? asRecord(event.original)
  const ids = [asString(payload?.id), asString(payload?.call_id), asString(event.payload.callId)]
  return ids.filter((id): id is string => Boolean(id))
}

const HISTORY_KIND: Record<string, TraceEvent['kind']> = { user: 'user', assistant: 'assistant', developer: 'system' }

/**
 * A `replacement_history` item keeps an event with the same host id, or else one
 * with the same role and text. The fallback also applies when the item has an id
 * that no event carries (the host re-ids some kept messages).
 */
function keptBy(event: TraceEvent, item: Record<string, unknown>): boolean {
  const id = asString(item.id) ?? asString(item.call_id)
  if (id && hostIds(event).includes(id))
    return true
  const role = asString(item.role)
  const text = textFrom(item.content)
  return role !== undefined && text !== undefined && event.kind === HISTORY_KIND[role] && event.payload.text === text
}

/** `compacted` hides earlier events of its agent that `replacement_history` does not keep. */
function shadowCompaction(events: TraceEvent[]): void {
  for (const compaction of events) {
    if (compaction.kind !== 'compaction')
      continue
    const items = asRecord(asRecord(compaction.original)?.payload)?.replacement_history
    const kept = Array.isArray(items)
      ? items.map(item => asRecord(item)).filter((item): item is Record<string, unknown> => item !== undefined)
      : undefined
    shadowBefore(events, compaction, kept ? event => kept.some(item => keptBy(event, item)) : undefined)
  }
}

function totalsKey(info: Record<string, unknown>): string {
  return JSON.stringify(info.total_token_usage ?? null)
}

/**
 * One `request` per model call. The usage source is `token_usage_record` from the
 * first such record on; earlier `token_count` records (a file written partly by an
 * older Codex) are the source before it. `token_count` with `info: null` or with
 * the same cumulative totals as the previous one is skipped.
 */
export function parseCodexRecords(records: SourcedRecord[], options?: { sessionId?: string }): ParsedSession {
  const events: TraceEvent[] = []
  const skipped: Trace['skipped'] = []
  const times = inheritTimes(records)
  const usedIds = new Set<string>()
  const responses = new Set<string>()
  const byTurn = new Map<string, TraceEvent[]>()
  const agents: AgentInfo[] = [{ id: 'main' }]
  let sessionId = options?.sessionId
  let cwd: string | undefined
  let title: string | undefined
  let version: string | undefined
  let startedAt: number | undefined
  let endedAt: number | undefined
  let model: string | undefined
  let usageRecords = false
  let previousTotals: string | undefined
  let segment = 0

  for (let index = 0; index < records.length; index++) {
    const record = records[index]!
    const ts = times[index]!
    const rec = asRecord(record.value)
    if (!rec || 'formatVersion' in rec)
      throw generationError(HOST, record.file, record.line)
    const envelope = asString(rec.type)
    if (!envelope) {
      const recordType = asString(rec.record_type)
      if (recordType)
        skipRecord(skipped, record, `record-${recordType}`)
      else if ('timestamp' in rec && 'id' in rec) {
        sessionId ??= asString(rec.id)
        skipRecord(skipped, record, 'legacy-header')
      }
      else {
        throw generationError(HOST, record.file, record.line)
      }
      continue
    }
    const bare = rec.payload == null && BARE_ITEM.has(envelope)
    const payload = bare ? rec : (asRecord(rec.payload) ?? {})
    startedAt = Math.min(startedAt ?? ts, ts)
    endedAt = Math.max(endedAt ?? ts, ts)

    const emit = (kind: TraceEvent['kind'], body: Record<string, unknown>, id?: string): TraceEvent => {
      let eventId = id ?? asString(payload.id) ?? lineKey(record)
      if (usedIds.has(eventId))
        eventId = lineKey(record)
      usedIds.add(eventId)
      const event = baseEvent(record, kind, body, { id: eventId, ts })
      events.push(event)
      return event
    }

    const request = (usage: Record<string, unknown> | undefined, responseId: string | undefined, turnId: string | undefined): void => {
      const key = responseId ?? lineKey(record)
      const body: Record<string, unknown> = {}
      if (model)
        body.model = model
      if (responseId)
        body.responseId = responseId
      const mapped = callUsage(usage)
      if (mapped)
        body.usage = mapped
      const event = baseEvent(record, 'request', body, { id: `request:${key}`, ts, requestId: key })
      usedIds.add(event.id)
      segment = placeRequest(events, segment, event)
      if (turnId)
        byTurn.set(turnId, [...(byTurn.get(turnId) ?? []), event])
    }

    if (envelope === 'session_meta') {
      // A forked or resumed rollout repeats earlier threads' `session_meta`; the first one is this file.
      sessionId ??= asString(payload.id) ?? asString(payload.session_id)
      cwd ??= asString(payload.cwd)
      version ??= asString(payload.cli_version)
      skipRecord(skipped, record, 'session-meta')
      continue
    }
    if (envelope === 'turn_context') {
      model = asString(payload.model) ?? model
      skipRecord(skipped, record, 'turn-context')
      continue
    }
    if (envelope === 'world_state' || envelope === 'inter_agent_communication_metadata') {
      skipRecord(skipped, record, envelope === 'world_state' ? 'world-state' : 'inter-agent')
      continue
    }
    if (envelope === 'token_usage_record') {
      usageRecords = true
      const responseId = asString(payload.response_id)
      if (responseId && responses.has(responseId)) {
        skipRecord(skipped, record, 'duplicate-usage')
        continue
      }
      if (responseId)
        responses.add(responseId)
      request(asRecord(payload.usage), responseId, asString(payload.turn_id))
      continue
    }
    if (envelope === 'event_msg' && payload.type === 'token_count') {
      const info = asRecord(payload.info)
      const reason = usageRecords ? 'other-usage-source' : !info ? 'empty-usage' : totalsKey(info) === previousTotals ? 'unchanged-usage' : undefined
      if (reason || !info) {
        skipRecord(skipped, record, reason ?? 'empty-usage')
        continue
      }
      previousTotals = totalsKey(info)
      request(asRecord(info.last_token_usage), undefined, undefined)
      continue
    }
    if (envelope === 'compacted' || (bare && envelope === 'compaction') || (envelope === 'response_item' && payload.type === 'compaction')) {
      emit('compaction', {})
      continue
    }

    if (envelope === 'event_msg') {
      const inner = asString(payload.type) ?? 'event_msg'
      if (inner === 'item_completed') {
        const item = asRecord(payload.item)
        const agentId = asString(item?.agent_thread_id)
        if (item?.type !== 'SubAgentActivity' || !agentId) {
          skipRecord(skipped, record, 'item-completed')
          continue
        }
        if (!agents.some(agent => agent.id === agentId))
          agents.push({ id: agentId, parentId: 'main' })
        const kind = asString(item.kind)
        const event = emit('system', { type: 'subagent', agentId, ...(kind ? { kind } : {}) }, asString(item.id))
        event.agentId = agentId
        continue
      }
      if (inner === 'task_complete' || inner === 'turn_aborted') {
        const turnId = asString(payload.turn_id)
        if (inner === 'turn_aborted') {
          for (const call of byTurn.get(turnId ?? '') ?? [])
            call.payload.stopReason ??= asString(payload.reason) ?? 'interrupted'
        }
        const durationMs = asNumber(payload.duration_ms)
        if (durationMs === undefined) {
          skipRecord(skipped, record, 'task-marker')
          continue
        }
        // Turn duration. It stays on the turn marker, never on a request.
        emit('system', { type: 'turn_duration', durationMs, ...(inner === 'turn_aborted' ? { aborted: true } : {}) }, lineKey(record))
        continue
      }
      const reason = inner === 'task_started' ? 'task-marker' : inner === 'thread_settings_applied' ? 'thread-settings' : inner === 'thread_goal_updated' ? 'thread-goal' : undefined
      if (reason)
        skipRecord(skipped, record, reason)
      else
        emit('unknown', { type: inner }, lineKey(record))
      continue
    }

    if (envelope !== 'response_item' && !bare) {
      emit('unknown', { type: envelope }, lineKey(record))
      continue
    }
    const inner = bare ? envelope : (asString(payload.type) ?? 'response_item')
    const event = emitInner(inner, payload, emit)
    if (event?.kind === 'user' && !event.payload.injected && !title)
      title = asString(event.payload.text)?.slice(0, 80)
  }

  shadowCompaction(events)
  markOrphanToolResults(events)
  assignSeq(events)
  return {
    events,
    skipped,
    version,
    agents,
    session: {
      id: sessionId ?? 'unknown',
      ...(title ? { title } : {}),
      ...(cwd ? { cwd } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(endedAt !== undefined ? { endedAt } : {}),
    },
  }
}
