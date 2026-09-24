import type { AgentInfo, RequestPayload, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { SourcedRecord } from '@rivus/agent-trace-kernel'
import {
  asNumber,
  asRecord,
  asString,
  assignSeq,
  basenamePath,
  generationError,
  markOrphanToolResults,
  sourceOf,
} from '@rivus/agent-trace-kernel'

const HOST = 'claude-code'

const BOOKKEEPING = new Set([
  'file-history-snapshot',
  'file-history-delta',
  'cost-state',
  'last-prompt',
  'atis-latch',
  'mode',
  'permission-mode',
  'queue-operation',
])

interface OpenRequest {
  requestId: string
  agentId?: string
  model?: string
  responseId?: string
  usage?: RequestPayload['usage']
  stopReason?: string
  startedAt?: number
  durationMs?: number
  ts: number
  source: TraceEvent['source']
  original: unknown
}

export interface ParsedClaude {
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

function eventId(uuid: string | undefined, record: SourcedRecord, part: number): string {
  if (uuid)
    return part === 0 ? uuid : `${uuid}:${part}`
  const base = basenamePath(record.file)
  return part === 0 ? `${base}:${record.line}` : `${base}:${record.line}:${part}`
}

function claudeUsage(message: Record<string, unknown>): RequestPayload['usage'] | undefined {
  const usage = asRecord(message.usage)
  if (!usage)
    return undefined
  const out: NonNullable<RequestPayload['usage']> = {}
  const input = asNumber(usage.input_tokens)
  const output = asNumber(usage.output_tokens)
  const cacheRead = asNumber(usage.cache_read_input_tokens)
  const cacheWrite = asNumber(usage.cache_creation_input_tokens)
  const reasoning = asNumber(asRecord(usage.output_tokens_details)?.thinking_tokens)
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

function assertGeneration(rec: Record<string, unknown>, record: SourcedRecord): void {
  if ('formatVersion' in rec)
    throw generationError(HOST, record.file, record.line)
  const version = rec.version
  if (typeof version === 'number' || (typeof version === 'string' && !/^\d+\.\d+\.\d+/.test(version)))
    throw generationError(HOST, record.file, record.line)
  if (typeof rec.type !== 'string')
    throw generationError(HOST, record.file, record.line)
}

function preservedUuids(events: TraceEvent[], compaction: TraceEvent): Set<string> | null {
  const segment = asRecord(asRecord(asRecord(compaction.original)?.compactMetadata)?.preservedSegment)
  const head = asString(segment?.headUuid)
  const tail = asString(segment?.tailUuid)
  if (!head || !tail)
    return null
  const keep = new Set<string>()
  let started = false
  for (const event of events) {
    if (event === compaction)
      break
    const uuid = asString(asRecord(event.original)?.uuid)
    if (!uuid)
      continue
    if (uuid === head)
      started = true
    if (started)
      keep.add(uuid)
    if (started && uuid === tail)
      break
  }
  return keep
}

function shadowRemoved(events: TraceEvent[]): void {
  for (const compaction of events) {
    if (compaction.kind !== 'compaction')
      continue
    const keep = preservedUuids(events, compaction)
    const agent = compaction.agentId ?? ''
    for (const event of events) {
      if (event === compaction)
        break
      if ((event.agentId ?? '') !== agent || event.kind === 'compaction' || event.shadowedBy)
        continue
      const uuid = asString(asRecord(event.original)?.uuid)
      if (keep && uuid && keep.has(uuid))
        continue
      event.shadowedBy = compaction.id
    }
  }
}

export function parseClaudeRecords(records: SourcedRecord[], options?: {
  sessionId?: string
  agentForFile?: (file: string) => string | undefined
}): ParsedClaude {
  const events: TraceEvent[] = []
  const skipped: Trace['skipped'] = []
  let open: OpenRequest | undefined
  let sessionId = options?.sessionId
  let title: string | undefined
  let cwd: string | undefined
  let version: string | undefined
  let startedAt: number | undefined
  let endedAt: number | undefined

  const flush = (): void => {
    if (!open)
      return
    const payload: Record<string, unknown> = {}
    if (open.model)
      payload.model = open.model
    if (open.responseId)
      payload.responseId = open.responseId
    if (open.usage)
      payload.usage = open.usage
    if (open.startedAt !== undefined)
      payload.startedAt = open.startedAt
    if (open.durationMs !== undefined)
      payload.durationMs = open.durationMs
    if (open.stopReason)
      payload.stopReason = open.stopReason
    const event: TraceEvent = {
      id: `request:${open.requestId}`,
      seq: 0,
      ts: open.ts,
      kind: 'request',
      requestId: open.requestId,
      payload,
      source: open.source,
      original: open.original,
    }
    if (open.agentId)
      event.agentId = open.agentId
    events.push(event)
    open = undefined
  }

  const applyDuration = (agentId: string | undefined, durationMs: number): void => {
    if (open && (open.agentId ?? '') === (agentId ?? '')) {
      open.durationMs = durationMs
      return
    }
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]!
      if (event.kind === 'request' && (event.agentId ?? '') === (agentId ?? '')) {
        event.payload.durationMs = durationMs
        return
      }
    }
  }

  for (const record of records) {
    const rec = asRecord(record.value)
    if (!rec)
      throw generationError(HOST, record.file, record.line)
    assertGeneration(rec, record)
    const type = asString(rec.type) ?? 'unknown'
    const uuid = asString(rec.uuid)
    const ts = timeOf(rec.timestamp) ?? 0
    const seenAt = timeOf(rec.timestamp)
    if (seenAt !== undefined) {
      if (startedAt === undefined || seenAt < startedAt)
        startedAt = seenAt
      if (endedAt === undefined || seenAt > endedAt)
        endedAt = seenAt
    }
    if (!sessionId)
      sessionId = asString(rec.sessionId)
    if (!cwd)
      cwd = asString(rec.cwd)
    if (!version && typeof rec.version === 'string')
      version = rec.version
    const agentId = asString(rec.agentId) ?? options?.agentForFile?.(record.file)
    const parentId = asString(rec.parentUuid)
    const source = sourceOf(record)

    const emit = (kind: TraceEvent['kind'], payload: Record<string, unknown>, part: number, requestId?: string): void => {
      const event: TraceEvent = {
        id: eventId(uuid, record, part),
        seq: 0,
        ts,
        kind,
        payload,
        source,
        original: record.value,
      }
      if (agentId)
        event.agentId = agentId
      if (parentId)
        event.parentId = parentId
      if (requestId)
        event.requestId = requestId
      events.push(event)
    }

    const skip = (reason: string): void => {
      skipped.push({ file: record.file, line: record.line, reason })
    }

    const noteRequest = (requestId: string, message: Record<string, unknown>): void => {
      if (open && open.requestId !== requestId)
        flush()
      if (!open) {
        open = { requestId, agentId, ts, source, original: record.value, startedAt: seenAt }
      }
      const usage = claudeUsage(message)
      if (usage) {
        open.usage = usage
        open.source = source
        open.original = record.value
      }
      const model = asString(message.model)
      if (model)
        open.model = model
      const responseId = asString(message.id)
      if (responseId)
        open.responseId = responseId
      const stopReason = asString(message.stop_reason)
      if (stopReason)
        open.stopReason = stopReason
    }

    if (type === 'user' || type === 'assistant') {
      const message = asRecord(rec.message) ?? {}
      const requestId = asString(rec.requestId)
      if (requestId)
        noteRequest(requestId, message)
      const role = type === 'user' ? 'user' : 'assistant'
      const content = message.content
      if (typeof content === 'string') {
        emit(role, content ? { text: content } : {}, 0, requestId)
        if (!title && role === 'user' && content)
          title = content.slice(0, 80)
      }
      else if (!Array.isArray(content) || content.length === 0) {
        emit(role, {}, 0, requestId)
      }
      else {
        content.forEach((block, part) => {
          const item = asRecord(block)
          const blockType = asString(item?.type)
          if (!item || !blockType) {
            emit('unknown', { type: 'block' }, part, requestId)
            return
          }
          if (blockType === 'text') {
            const text = asString(item.text) ?? ''
            emit(role, text ? { text } : {}, part, requestId)
            if (!title && role === 'user' && text)
              title = text.slice(0, 80)
            return
          }
          if (blockType === 'thinking' || blockType === 'redacted_thinking') {
            const text = asString(item.thinking)
            emit('thinking', text ? { text } : { redacted: true }, part, requestId)
            return
          }
          if (blockType === 'tool_use') {
            const payload: Record<string, unknown> = {
              callId: asString(item.id) ?? '',
              name: asString(item.name) ?? '',
            }
            if (item.input !== undefined)
              payload.args = item.input
            emit('tool_call', payload, part, requestId)
            return
          }
          if (blockType === 'tool_result') {
            const payload: Record<string, unknown> = { callId: asString(item.tool_use_id) ?? '' }
            if (item.content !== undefined)
              payload.output = item.content
            if (typeof item.is_error === 'boolean')
              payload.isError = item.is_error
            emit('tool_result', payload, part, requestId)
            return
          }
          emit('unknown', { type: blockType }, part, requestId)
        })
      }
      continue
    }

    if (type === 'system') {
      const subtype = asString(rec.subtype) ?? 'system'
      if (subtype === 'compact_boundary') {
        flush()
        const meta = asRecord(rec.compactMetadata)
        const trigger = asString(meta?.trigger)
        const pre = asNumber(meta?.preTokens)
        const post = asNumber(meta?.postTokens)
        const payload: Record<string, unknown> = {}
        if (trigger === 'auto' || trigger === 'manual')
          payload.trigger = trigger
        if (pre !== undefined)
          payload.preTokens = pre
        if (post !== undefined)
          payload.postTokens = post
        emit('compaction', payload, 0)
        continue
      }
      if (subtype === 'turn_duration') {
        const durationMs = asNumber(rec.durationMs)
        if (durationMs !== undefined)
          applyDuration(agentId, durationMs)
        emit('system', {
          type: 'turn_duration',
          ...(durationMs !== undefined ? { durationMs } : {}),
        }, 0)
        continue
      }
      if (subtype === 'stop_hook_summary' || subtype.includes('hook')) {
        emit('hook', { type: subtype }, 0)
        continue
      }
      const text = asString(rec.content)
      emit('system', { type: subtype, ...(text ? { text } : {}) }, 0)
      continue
    }

    if (type === 'attachment') {
      const attachment = asRecord(rec.attachment)
      const attachmentType = asString(attachment?.type) ?? ''
      if (attachmentType.startsWith('hook_')) {
        const payload: Record<string, unknown> = { type: attachmentType }
        const name = asString(attachment?.hookName)
        const hookEvent = asString(attachment?.hookEvent)
        const exitCode = asNumber(attachment?.exitCode)
        if (name)
          payload.name = name
        if (hookEvent)
          payload.event = hookEvent
        if (exitCode !== undefined)
          payload.exitCode = exitCode
        emit('hook', payload, 0)
      }
      else {
        skip(`attachment:${attachmentType || 'record'}`)
      }
      continue
    }

    if (type === 'ai-title' || type === 'summary') {
      const next = asString(rec.aiTitle) ?? asString(rec.summary) ?? asString(rec.title)
      if (next && !title)
        title = next
      skip(type)
      continue
    }

    if (BOOKKEEPING.has(type)) {
      skip(type)
      continue
    }

    emit('unknown', { type }, 0)
  }

  flush()
  shadowRemoved(events)
  markOrphanToolResults(events)
  assignSeq(events)

  const agents: AgentInfo[] = [{ id: 'main' }]
  const seenAgents = new Set<string>()
  for (const event of events) {
    if (!event.agentId || event.agentId === 'main' || seenAgents.has(event.agentId))
      continue
    seenAgents.add(event.agentId)
    agents.push({ id: event.agentId, parentId: 'main' })
  }

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
