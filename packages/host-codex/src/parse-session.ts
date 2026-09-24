import type { AgentInfo, RequestPayload, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { SourcedRecord } from '@rivus/agent-trace-kernel'
import {
  asBoolean,
  asNumber,
  asRecord,
  asString,
  assignSeq,
  basenamePath,
  generationError,
  markOrphanToolResults,
  sourceOf,
} from '@rivus/agent-trace-kernel'

const HOST = 'codex'
const BARE_ITEM = new Set(['message', 'reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output', 'compaction'])

interface Timing {
  durationMs?: number
  startedAt?: number
}

export interface ParsedCodex {
  events: TraceEvent[]
  skipped: Trace['skipped']
  session: Trace['session']
  version?: string
  agents: AgentInfo[]
}

function timeOf(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return value < 1e12 ? value * 1000 : value
  if (typeof value === 'string' && value) {
    const ms = Date.parse(value)
    if (!Number.isNaN(ms))
      return ms
  }
  return undefined
}

function textFrom(content: unknown): string | undefined {
  if (typeof content === 'string')
    return content
  if (!Array.isArray(content))
    return undefined
  const parts: string[] = []
  for (const part of content) {
    const rec = asRecord(part)
    const text = asString(rec?.text) ?? asString(rec?.output)
    if (text)
      parts.push(text)
  }
  return parts.length > 0 ? parts.join('') : undefined
}

function argsOf(value: unknown): unknown {
  if (typeof value !== 'string')
    return value
  try {
    return JSON.parse(value) as unknown
  }
  catch {
    return value
  }
}

function usageOf(raw: Record<string, unknown> | undefined): RequestPayload['usage'] | undefined {
  if (!raw)
    return undefined
  const out: NonNullable<RequestPayload['usage']> = {}
  const input = asNumber(raw.input_tokens)
  const output = asNumber(raw.output_tokens)
  const cacheRead = asNumber(raw.cached_input_tokens)
  const cacheWrite = asNumber(raw.cache_write_input_tokens)
  const reasoning = asNumber(raw.reasoning_output_tokens)
  if (input !== undefined)
    out.inputTokens = input
  if (output !== undefined)
    out.outputTokens = output
  if (cacheRead !== undefined)
    out.cacheReadTokens = cacheRead
  if (cacheWrite !== undefined)
    out.cacheWriteTokens = cacheWrite
  if (reasoning !== undefined)
    out.reasoningTokens = reasoning
  return Object.keys(out).length > 0 ? out : undefined
}

function resultFlags(payload: Record<string, unknown>): { isError?: boolean, exitCode?: number } {
  const exitCode = asNumber(payload.exit_code ?? payload.exitCode)
  const explicit = asBoolean(payload.is_error) ?? asBoolean(payload.isError) ?? asBoolean(asRecord(payload.output)?.isError)
  const failed = explicit === true || (exitCode !== undefined && exitCode !== 0)
  if (!failed && explicit !== false && exitCode !== 0)
    return exitCode !== undefined ? { exitCode } : {}
  return {
    ...(failed || explicit === false ? { isError: failed } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  }
}

function hostIds(event: TraceEvent): string[] {
  const payload = asRecord(asRecord(event.original)?.payload)
  const ids = [asString(payload?.id), asString(payload?.call_id), asString(event.payload.callId)]
  return ids.filter((id): id is string => Boolean(id))
}

function shadowCompaction(events: TraceEvent[]): void {
  for (const compaction of events) {
    if (compaction.kind !== 'compaction')
      continue
    const history = asRecord(compaction.original)?.payload
    const items = asRecord(history)?.replacement_history
    const list = Array.isArray(items) ? items : null
    const keep = new Set<string>()
    if (list) {
      for (const item of list) {
        const rec = asRecord(item)
        const id = asString(rec?.id) ?? asString(rec?.call_id)
        if (id)
          keep.add(id)
      }
    }
    for (const event of events) {
      if (event === compaction)
        break
      if (event.kind === 'compaction' || event.shadowedBy)
        continue
      if (list && hostIds(event).some(id => keep.has(id)))
        continue
      event.shadowedBy = compaction.id
    }
  }
}

export function parseCodexRecords(records: SourcedRecord[], options?: { sessionId?: string }): ParsedCodex {
  const events: TraceEvent[] = []
  const skipped: Trace['skipped'] = []
  const models = new Map<string, string>()
  const timings = new Map<string, Timing>()
  const requests = new Map<string, TraceEvent>()
  const agents: AgentInfo[] = [{ id: 'main' }]
  const agentIds = new Set<string>()
  let sessionId = options?.sessionId
  let cwd: string | undefined
  let title: string | undefined
  let version: string | undefined
  let startedAt: number | undefined
  let endedAt: number | undefined
  let watermark = 0

  const rememberAgent = (id: string | undefined): void => {
    if (!id || id === 'main' || agentIds.has(id))
      return
    agentIds.add(id)
    agents.push({ id, parentId: 'main' })
  }

  const stamp = (requestId: string): void => {
    for (let index = watermark; index < events.length; index++) {
      const event = events[index]!
      if (!event.requestId && event.kind !== 'request')
        event.requestId = requestId
    }
    watermark = events.length
  }

  const applyTiming = (event: TraceEvent, turnId: string | undefined): void => {
    if (!turnId)
      return
    const timing = timings.get(turnId)
    if (!timing)
      return
    if (timing.durationMs !== undefined && event.payload.durationMs == null)
      event.payload.durationMs = timing.durationMs
    if (timing.startedAt !== undefined && event.payload.startedAt == null)
      event.payload.startedAt = timing.startedAt
  }

  const openRequest = (key: string, record: SourcedRecord, ts: number, turnId: string | undefined, rank: number): TraceEvent | undefined => {
    const existing = requests.get(key)
    if (existing) {
      if (rank <= 1)
        return undefined
      return existing
    }
    const payload: Record<string, unknown> = {}
    const model = turnId ? models.get(turnId) : undefined
    if (model)
      payload.model = model
    if (key !== turnId)
      payload.responseId = key
    const event: TraceEvent = {
      id: `request:${key}`,
      seq: 0,
      ts,
      kind: 'request',
      requestId: key,
      payload,
      source: sourceOf(record),
      original: record.value,
    }
    requests.set(key, event)
    events.push(event)
    applyTiming(event, turnId)
    stamp(key)
    return event
  }

  for (const record of records) {
    const rec = asRecord(record.value)
    if (!rec)
      throw generationError(HOST, record.file, record.line)
    if ('formatVersion' in rec)
      throw generationError(HOST, record.file, record.line)
    const envelope = asString(rec.type)
    if (!envelope && asString(rec.record_type)) {
      skipped.push({ file: record.file, line: record.line, reason: `record-${asString(rec.record_type)}` })
      continue
    }
    if (!envelope) {
      if ('timestamp' in rec) {
        sessionId = asString(rec.id) ?? sessionId
        const headerAt = timeOf(rec.timestamp)
        if (headerAt !== undefined && (startedAt === undefined || headerAt < startedAt))
          startedAt = headerAt
        skipped.push({ file: record.file, line: record.line, reason: 'legacy-header' })
      }
      else {
        throw generationError(HOST, record.file, record.line)
      }
      continue
    }
    let payload = asRecord(rec.payload) ?? {}
    const bare = rec.payload == null && BARE_ITEM.has(envelope)
    if (bare)
      payload = rec
    const ts = timeOf(rec.timestamp) ?? timeOf(payload.timestamp) ?? 0
    const seenAt = timeOf(rec.timestamp) ?? timeOf(payload.timestamp)
    if (seenAt !== undefined) {
      if (startedAt === undefined || seenAt < startedAt)
        startedAt = seenAt
      if (endedAt === undefined || seenAt > endedAt)
        endedAt = seenAt
    }
    const source = sourceOf(record)
    const skip = (reason: string): void => {
      skipped.push({ file: record.file, line: record.line, reason })
    }
    const emit = (kind: TraceEvent['kind'], body: Record<string, unknown>, id?: string): TraceEvent => {
      const event: TraceEvent = {
        id: id ?? asString(payload.id) ?? `${basenamePath(record.file)}:${record.line}`,
        seq: 0,
        ts,
        kind,
        payload: body,
        source,
        original: record.value,
      }
      events.push(event)
      return event
    }

    if (envelope === 'session_meta') {
      sessionId = asString(payload.session_id) ?? asString(payload.id) ?? sessionId
      cwd = asString(payload.cwd) ?? cwd
      version = asString(payload.cli_version) ?? version
      skip('session-meta')
      continue
    }

    if (envelope === 'turn_context') {
      const turnId = asString(payload.turn_id)
      const model = asString(payload.model)
      if (turnId && model) {
        models.set(turnId, model)
        const request = turnId ? requests.get(turnId) : undefined
        if (request && request.payload.model == null)
          request.payload.model = model
      }
      skip('turn-context')
      continue
    }

    if (envelope === 'world_state') {
      skip('world-state')
      continue
    }

    if (envelope === 'token_usage_record' || (envelope === 'event_msg' && asString(payload.type) === 'token_count')) {
      const turnId = asString(payload.turn_id) ?? asString(payload.thread_id)
      const responseId = asString(payload.response_id)
      const key = responseId ?? turnId ?? `line:${record.line}`
      const raw = asRecord(payload.turn_token_usage)
        ?? asRecord(payload.usage)
        ?? asRecord(asRecord(payload.info)?.last_token_usage)
      const existing = requests.get(key) ?? (turnId ? requests.get(turnId) : undefined)
      if (existing && envelope !== 'token_usage_record') {
        skip('folded-usage')
        continue
      }
      if (existing && existing.source.line !== record.line) {
        const usage = usageOf(raw)
        if (usage)
          existing.payload.usage = usage
        if (responseId)
          existing.payload.responseId = responseId
        const model = turnId ? models.get(turnId) : undefined
        if (model && existing.payload.model == null)
          existing.payload.model = model
        skip('folded-usage')
        continue
      }
      const event = openRequest(key, record, ts, turnId, envelope === 'token_usage_record' ? 2 : 1)
      if (event) {
        const usage = usageOf(raw)
        if (usage)
          event.payload.usage = usage
        if (turnId && key !== turnId)
          requests.set(turnId, event)
      }
      else {
        skip('folded-usage')
      }
      continue
    }

    if (envelope === 'compacted' || (bare && envelope === 'compaction') || (envelope === 'response_item' && asString(payload.type) === 'compaction')) {
      const id = asString(payload.id) ?? `${basenamePath(record.file)}:${record.line}`
      emit('compaction', {}, id)
      continue
    }

    if (envelope === 'inter_agent_communication_metadata') {
      const agentId = asString(payload.agent_thread_id)
        ?? asString(payload.agent_id)
        ?? asString(payload.subagent_id)
      if (!agentId) {
        skip('inter-agent')
        continue
      }
      rememberAgent(agentId)
      const event = emit('system', { type: 'inter_agent', agentId }, `${basenamePath(record.file)}:${record.line}`)
      event.agentId = agentId
      continue
    }

    if (envelope === 'event_msg') {
      const inner = asString(payload.type) ?? 'event_msg'
      const turnId = asString(payload.turn_id)
      if (inner === 'item_completed') {
        const item = asRecord(payload.item)
        if (asString(item?.type) === 'SubAgentActivity') {
          const agentId = asString(item?.agent_thread_id)
          rememberAgent(agentId)
          const event = emit('system', {
            type: 'subagent',
            ...(agentId ? { agentId } : {}),
          }, asString(item?.id) ?? `${basenamePath(record.file)}:${record.line}`)
          if (agentId)
            event.agentId = agentId
          continue
        }
        const start = asNumber(payload.started_at_ms)
        const end = asNumber(payload.completed_at_ms)
        if (turnId && start !== undefined && end !== undefined && end >= start) {
          const timing = timings.get(turnId) ?? {}
          if (timing.durationMs === undefined)
            timing.durationMs = end - start
          if (timing.startedAt === undefined)
            timing.startedAt = start
          timings.set(turnId, timing)
          const request = requests.get(turnId)
          if (request)
            applyTiming(request, turnId)
        }
        skip('item-completed')
        continue
      }
      if (inner === 'task_complete' || inner === 'task_started' || inner === 'turn_aborted') {
        if (turnId) {
          const timing = timings.get(turnId) ?? {}
          const durationMs = asNumber(payload.duration_ms)
          const started = asNumber(payload.started_at_ms) ?? timeOf(payload.started_at)
          if (durationMs !== undefined)
            timing.durationMs = durationMs
          if (started !== undefined)
            timing.startedAt = started
          timings.set(turnId, timing)
          const request = requests.get(turnId)
          if (request) {
            applyTiming(request, turnId)
            if (inner === 'turn_aborted' && request.payload.stopReason == null)
              request.payload.stopReason = asString(payload.reason) ?? 'interrupted'
          }
        }
        skip('task-marker')
        continue
      }
      if (inner === 'thread_settings_applied') {
        skip('thread-settings')
        continue
      }
      if (inner === 'thread_goal_updated') {
        skip('thread-goal')
        continue
      }
      emit('unknown', { type: inner })
      continue
    }

    if (envelope !== 'response_item' && !bare) {
      emit('unknown', { type: envelope })
      continue
    }

    const inner = bare ? envelope : (asString(payload.type) ?? 'response_item')
    const turnId = asString(asRecord(payload.internal_chat_message_metadata_passthrough)?.turn_id)
    let event: TraceEvent | undefined
    if (inner === 'message') {
      const role = asString(payload.role)
      const text = textFrom(payload.content)
      const kind = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system'
      event = emit(kind, text ? { text } : {})
      if (!title && kind === 'user' && text)
        title = text.slice(0, 80)
    }
    else if (inner === 'reasoning') {
      const text = textFrom(payload.summary)
      event = emit('thinking', text ? { text } : {})
    }
    else if (inner === 'function_call' || inner === 'custom_tool_call') {
      const body: Record<string, unknown> = {
        callId: asString(payload.call_id) ?? '',
        name: asString(payload.name) ?? '',
      }
      const args = payload.arguments ?? payload.input
      if (args !== undefined)
        body.args = argsOf(args)
      event = emit('tool_call', body)
    }
    else if (inner === 'function_call_output' || inner === 'custom_tool_call_output') {
      const body: Record<string, unknown> = {
        callId: asString(payload.call_id) ?? '',
        ...resultFlags(payload),
      }
      if (payload.output !== undefined)
        body.output = payload.output
      event = emit('tool_result', body)
      const callId = asString(body.callId)
      if (callId) {
        for (let index = events.length - 2; index >= 0; index--) {
          const prior = events[index]!
          if (prior.kind === 'tool_call' && prior.payload.callId === callId && prior.requestId) {
            event.requestId = prior.requestId
            break
          }
        }
      }
    }
    else if (inner !== 'compaction') {
      event = emit('unknown', { type: inner })
    }
    if (event && turnId && !event.requestId) {
      const request = requests.get(turnId)
      if (request?.requestId)
        event.requestId = request.requestId
    }
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
