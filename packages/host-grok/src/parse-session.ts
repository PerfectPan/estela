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

const HOST = 'grok'

const PROGRESS = new Set(['in_progress', 'running', 'started', 'pending'])

const BOOKKEEPING = new Set([
  'background_tasks',
  'task_backgrounded',
  'task_completed',
  'session_recap',
  'retry_state',
  'plan',
  'image_compressed',
])

export interface GrokSessionMeta {
  id?: string
  title?: string
  cwd?: string
  startedAt?: number
  endedAt?: number
  systemPrompt?: string
  tools?: unknown
  version?: string
}

export interface ParsedGrok {
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

function usageOf(raw: Record<string, unknown> | undefined): RequestPayload['usage'] | undefined {
  if (!raw)
    return undefined
  const out: NonNullable<RequestPayload['usage']> = {}
  const input = asNumber(raw.inputTokens)
  const output = asNumber(raw.outputTokens)
  const cacheRead = asNumber(raw.cachedReadTokens ?? raw.cacheReadTokens)
  const cacheWrite = asNumber(raw.cacheCreationTokens ?? raw.cacheWriteTokens)
  const reasoning = asNumber(raw.reasoningTokens)
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

function promptKey(update: Record<string, unknown>): string | undefined {
  const meta = asRecord(update._meta)
  const index = asNumber(meta?.promptIndex ?? update.promptIndex)
  if (index !== undefined)
    return String(index)
  return asString(update.prompt_id) ?? asString(meta?.promptId)
}

function shadowCompaction(events: TraceEvent[]): void {
  for (const compaction of events) {
    if (compaction.kind !== 'compaction')
      continue
    const agent = compaction.agentId ?? ''
    for (const event of events) {
      if (event === compaction)
        break
      if ((event.agentId ?? '') !== agent || event.kind === 'compaction' || event.shadowedBy)
        continue
      event.shadowedBy = compaction.id
    }
  }
}

export function parseGrokRecords(records: SourcedRecord[], meta: GrokSessionMeta = {}): ParsedGrok {
  const events: TraceEvent[] = []
  const skipped: Trace['skipped'] = []
  const agents: AgentInfo[] = [{ id: 'main' }]
  const agentIds = new Set<string>()
  let currentKey: string | undefined
  let model: string | undefined
  let startedAt = meta.startedAt
  let endedAt = meta.endedAt

  const rememberAgent = (id: string, title?: string, spawnEventId?: string): void => {
    if (!id || id === 'main')
      return
    if (agentIds.has(id)) {
      const existing = agents.find(agent => agent.id === id)
      if (existing && !existing.title && title)
        existing.title = title
      if (existing && !existing.spawnEventId && spawnEventId)
        existing.spawnEventId = spawnEventId
      return
    }
    agentIds.add(id)
    agents.push({
      id,
      parentId: 'main',
      ...(title ? { title } : {}),
      ...(spawnEventId ? { spawnEventId } : {}),
    })
  }

  for (const record of records) {
    const rec = asRecord(record.value)
    if (!rec)
      throw generationError(HOST, record.file, record.line)
    if ('formatVersion' in rec)
      throw generationError(HOST, record.file, record.line)
    const update = asRecord(asRecord(rec.params)?.update) ?? asRecord(rec.update)
    if (!update)
      throw generationError(HOST, record.file, record.line)
    if ('formatVersion' in update)
      throw generationError(HOST, record.file, record.line)
    const schemaVersion = asNumber(update.schema_version)
    if (schemaVersion !== undefined && schemaVersion !== 1)
      throw generationError(HOST, record.file, record.line)

    const kind = asString(update.sessionUpdate) ?? 'update'
    const ts = timeOf(rec.timestamp) ?? 0
    const seenAt = timeOf(rec.timestamp)
    if (seenAt !== undefined) {
      if (startedAt === undefined || seenAt < startedAt)
        startedAt = seenAt
      if (endedAt === undefined || seenAt > endedAt)
        endedAt = seenAt
    }
    const key = promptKey(update)
    if (key)
      currentKey = key
    const metaModel = asString(asRecord(update._meta)?.modelId)
    if (metaModel)
      model = metaModel
    const source = sourceOf(record)
    const requestId = currentKey
    const skip = (reason: string): void => {
      skipped.push({ file: record.file, line: record.line, reason })
    }
    const emit = (eventKind: TraceEvent['kind'], payload: Record<string, unknown>, id?: string): TraceEvent => {
      const event: TraceEvent = {
        id: id ?? `${basenamePath(record.file)}:${record.line}`,
        seq: 0,
        ts,
        kind: eventKind,
        payload,
        source,
        original: record.value,
      }
      if (requestId && eventKind !== 'request')
        event.requestId = requestId
      events.push(event)
      return event
    }

    if (kind === 'user_message_chunk' || kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const text = chunkText(update.content)
      const mapped = kind === 'user_message_chunk'
        ? 'user'
        : kind === 'agent_thought_chunk' ? 'thinking' : 'assistant'
      emit(mapped, text ? { text } : {})
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
        skip(PROGRESS.has(status) || status ? 'tool-progress' : 'tool-progress')
        continue
      }
      const payload: Record<string, unknown> = {
        callId: asString(update.toolCallId) ?? '',
        isError: status !== 'completed',
      }
      if (update.content !== undefined)
        payload.output = chunkText(update.content) || update.content
      if (update.rawOutput !== undefined && payload.output == null)
        payload.output = update.rawOutput
      emit('tool_result', payload)
      continue
    }

    if (kind === 'turn_completed') {
      const usage = usageOf(asRecord(update.usage))
      const durationMs = asNumber(update.elapsed_ms)
      const payload: Record<string, unknown> = {}
      if (model)
        payload.model = model
      if (usage)
        payload.usage = usage
      if (durationMs !== undefined)
        payload.durationMs = durationMs
      const stop = asString(update.stop_reason)
      if (stop)
        payload.stopReason = stop
      const idKey = currentKey ?? asString(update.prompt_id) ?? String(record.line)
      let id = `request:${idKey}`
      if (events.some(event => event.id === id))
        id = `request:${idKey}:${record.line}`
      const event = emit('request', payload, id)
      event.requestId = idKey
      continue
    }

    if (kind === 'hook_execution') {
      const name = asString(update.event_name) ?? asString(update.hookName)
      emit('hook', { type: 'hook_execution', ...(name ? { name } : {}) })
      continue
    }

    if (kind === 'auto_compact_completed' || kind === 'auto_compact_started') {
      if (kind === 'auto_compact_started') {
        const later = records.slice(records.indexOf(record) + 1).some((item) => {
          const next = asRecord(asRecord(asRecord(item.value)?.params)?.update)
          return asString(next?.sessionUpdate) === 'auto_compact_completed'
        })
        if (later) {
          skip('compact-started')
          continue
        }
      }
      const pre = asNumber(update.tokens_before ?? update.tokens_used)
      const post = asNumber(update.tokens_after)
      const payload: Record<string, unknown> = { trigger: 'auto' }
      if (pre !== undefined)
        payload.preTokens = pre
      if (post !== undefined)
        payload.postTokens = post
      emit('compaction', payload, `${basenamePath(record.file)}:${record.line}`)
      continue
    }

    if (kind === 'compaction_checkpoint') {
      skip('compaction-checkpoint')
      continue
    }

    if (kind === 'subagent_spawned' || kind === 'subagent_finished') {
      const agentId = asString(update.subagent_id) ?? asString(update.child_session_id) ?? ''
      const title = asString(update.description)
      const event = emit('system', {
        type: kind,
        ...(agentId ? { agentId } : {}),
        ...(asString(update.status) ? { status: asString(update.status) } : {}),
        ...(asNumber(update.duration_ms) !== undefined ? { durationMs: asNumber(update.duration_ms) } : {}),
      })
      if (agentId)
        rememberAgent(agentId, title, kind === 'subagent_spawned' ? event.id : undefined)
      continue
    }

    if (BOOKKEEPING.has(kind)) {
      skip(kind)
      continue
    }

    emit('unknown', { type: kind })
  }

  shadowCompaction(events)
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

/** Row helper kept for unit tests. Side files are passed through `meta`. */
export function parseGrokUpdates(rows: unknown[], extras?: {
  sessionId?: string
  cwd?: string
  title?: string
  systemPrompt?: string
  tools?: unknown
}): Trace {
  const records: SourcedRecord[] = rows.map((value, index) => {
    const text = JSON.stringify(value)
    return {
      file: 'updates.jsonl',
      offset: 0,
      length: new TextEncoder().encode(text).byteLength,
      line: index + 1,
      value,
    }
  })
  const parsed = parseGrokRecords(records, {
    id: extras?.sessionId,
    cwd: extras?.cwd,
    title: extras?.title,
    systemPrompt: extras?.systemPrompt,
    tools: extras?.tools,
  })
  return {
    schema: 'agent-trace',
    host: { id: 'grok' },
    session: parsed.session,
    capabilities: [
      'requests',
      'usage',
      'durations',
      'thinking',
      'compaction',
      'compactionTokens',
      'subagents',
      'hooks',
      'systemPrompt',
      'toolSchemas',
    ],
    agents: parsed.agents,
    events: parsed.events,
    skipped: parsed.skipped,
  }
}
