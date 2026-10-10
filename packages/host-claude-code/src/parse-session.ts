import type { AgentInfo, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import type { ParsedSession, SourcedRecord } from '@rivus/agent-trace-kernel'
import {
  asNumber,
  asRecord,
  asString,
  assignSeq,
  baseEvent,
  generationError,
  lineId,
  markOrphanToolResults,
  promptSnapshot,
  shadowBefore,
  skipRecord,
  usageFrom,
} from '@rivus/agent-trace-kernel'
import { applySnapshots, snapshotPayload } from './prompt-snapshot.ts'
import { isPrompt, recordText, userFlags } from './user-flags.ts'

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
  'relocated',
  'worktree-state',
  'fork-context-ref',
  'pr-link',
  'frame-link',
])

/** Fields from `subagents/agent-<id>.meta.json`. */
export interface AgentMeta {
  title?: string
  toolUseId?: string
  parentAgentId?: string
}

export interface StampedRecord {
  record: SourcedRecord
  ts: number
}

function eventId(uuid: string | undefined, record: SourcedRecord, part: number): string {
  if (!uuid) {
    return lineId(record, part)
  }
  return part === 0 ? uuid : `${uuid}:${part}`
}

function claudeUsage(message: Record<string, unknown>) {
  const usage = asRecord(message.usage)
  if (!usage) {
    return undefined
  }
  return usageFrom({
    input: asNumber(usage.input_tokens),
    output: asNumber(usage.output_tokens),
    cacheRead: asNumber(usage.cache_read_input_tokens),
    cacheWrite: asNumber(usage.cache_creation_input_tokens),
    reasoning: asNumber(asRecord(usage.output_tokens_details)?.thinking_tokens),
    includeCacheInInput: true,
  })
}

function assertGeneration(rec: Record<string, unknown>, record: SourcedRecord): void {
  if ('formatVersion' in rec) {
    throw generationError(HOST, record.file, record.line)
  }
  const version = rec.version
  if (typeof version === 'number' || (typeof version === 'string' && !/^\d+\.\d+\.\d+/.test(version))) {
    throw generationError(HOST, record.file, record.line)
  }
  if (typeof rec.type !== 'string') {
    throw generationError(HOST, record.file, record.line)
  }
}

function preservedUuids(events: TraceEvent[], compaction: TraceEvent): Set<string> | null {
  const segment = asRecord(asRecord(asRecord(compaction.original)?.compactMetadata)?.preservedSegment)
  const head = asString(segment?.headUuid)
  const tail = asString(segment?.tailUuid)
  if (!head || !tail) {
    return null
  }
  const keep = new Set<string>()
  let started = false
  for (const event of events) {
    if (event === compaction) {
      break
    }
    const uuid = asString(asRecord(event.original)?.uuid)
    if (!uuid) {
      continue
    }
    if (uuid === head) {
      started = true
    }
    if (started) {
      keep.add(uuid)
    }
    if (started && uuid === tail) {
      break
    }
  }
  return keep
}

function shadowRemoved(events: TraceEvent[]): void {
  for (const compaction of events) {
    if (compaction.kind !== 'compaction') {
      continue
    }
    const keep = preservedUuids(events, compaction)
    // A prompt snapshot is not conversation: a compaction does not remove it.
    shadowBefore(events, compaction, event => {
      if (promptSnapshot(event)) {
        return true
      }
      if (!keep) {
        return false
      }
      const uuid = asString(asRecord(event.original)?.uuid)
      return Boolean(uuid && keep.has(uuid))
    })
  }
}

/**
 * One lane per agent id. The spawning tool call comes from `meta.json`
 * `toolUseId`, else from the tool result whose `toolUseResult.agentId` names
 * the agent. A lane with neither has no `spawnEventId`.
 */
function agentLanes(events: TraceEvent[], metas?: ReadonlyMap<string, AgentMeta>): AgentInfo[] {
  const calls = new Map<string, TraceEvent>()
  const spawnCall = new Map<string, string>()
  for (const event of events) {
    const callId = asString(event.payload.callId)
    if (event.kind === 'tool_call' && callId) {
      calls.set(callId, event)
    }
    const spawned = asString(asRecord(asRecord(event.original)?.toolUseResult)?.agentId)
    if (event.kind === 'tool_result' && callId && spawned && !spawnCall.has(spawned)) {
      spawnCall.set(spawned, callId)
    }
  }
  const agents: AgentInfo[] = [{ id: 'main' }]
  const seen = new Set<string>(['main'])
  for (const event of events) {
    const id = event.agentId
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    const meta = metas?.get(id)
    const spawn = calls.get(meta?.toolUseId ?? spawnCall.get(id) ?? '')
    const agent: AgentInfo = { id, parentId: meta?.parentAgentId ?? spawn?.agentId ?? 'main' }
    if (spawn) {
      agent.spawnEventId = spawn.id
    }
    if (meta?.title) {
      agent.title = meta.title
    }
    agents.push(agent)
  }
  return agents
}

export function parseClaudeRecords(
  stamped: readonly StampedRecord[],
  options?: {
    sessionId?: string
    agentForFile?: (file: string) => string | undefined
    agentMeta?: ReadonlyMap<string, AgentMeta>
  },
): ParsedSession {
  const events: TraceEvent[] = []
  const skipped: Trace['skipped'] = []
  const requests = new Map<string, TraceEvent>()
  let sessionId = options?.sessionId
  let title: string | undefined
  let titleExplicit = false
  let cwd: string | undefined
  let version: string | undefined
  let startedAt: number | undefined
  let endedAt: number | undefined

  const rememberTitle = (text: string | undefined, explicit = false): void => {
    if (!text) {
      return
    }
    if (explicit) {
      title = text
      titleExplicit = true
      return
    }
    if (!titleExplicit && !title) {
      title = text.slice(0, 80)
    }
  }

  for (const { record, ts } of stamped) {
    const rec = asRecord(record.value)
    if (!rec) {
      throw generationError(HOST, record.file, record.line)
    }
    assertGeneration(rec, record)
    const type = asString(rec.type) ?? 'unknown'
    const uuid = asString(rec.uuid)
    if (startedAt === undefined || ts < startedAt) {
      startedAt = ts
    }
    if (endedAt === undefined || ts > endedAt) {
      endedAt = ts
    }
    if (!sessionId) {
      sessionId = asString(rec.sessionId)
    }
    if (!cwd) {
      cwd = asString(rec.cwd)
    }
    if (!version && typeof rec.version === 'string') {
      version = rec.version
    }
    let agentId = asString(rec.agentId) ?? options?.agentForFile?.(record.file)
    if (rec.isSidechain === true) {
      agentId = asString(rec.agentId) ?? agentId ?? 'sidechain'
    }
    const parentId = asString(rec.parentUuid)

    const emit = (
      kind: TraceEvent['kind'],
      payload: Record<string, unknown>,
      part: number,
      requestId?: string,
    ): void => {
      events.push(
        baseEvent(record, kind, payload, {
          id: eventId(uuid, record, part),
          ts,
          agentId,
          parentId,
          requestId,
        }),
      )
    }

    const ensureRequest = (requestId: string, message: Record<string, unknown>): void => {
      let event = requests.get(requestId)
      if (!event) {
        event = baseEvent(
          record,
          'request',
          {},
          {
            id: `request:${requestId}`,
            ts,
            agentId,
            requestId,
          },
        )
        requests.set(requestId, event)
        events.push(event)
      }
      const usage = claudeUsage(message)
      if (usage) {
        event.payload.usage = usage
      }
      const model = asString(message.model)
      if (model) {
        event.payload.model = model
      }
      const responseId = asString(message.id)
      if (responseId) {
        event.payload.responseId = responseId
      }
      const stopReason = asString(message.stop_reason)
      if (stopReason) {
        event.payload.stopReason = stopReason
      }
    }

    if (type === 'user' || type === 'assistant') {
      const message = asRecord(rec.message) ?? {}
      const requestId = asString(rec.requestId)
      if (requestId) {
        ensureRequest(requestId, message)
      }
      const role = type === 'user' ? 'user' : 'assistant'
      const flags = role === 'user' ? userFlags(rec, message.content) : {}
      const content = message.content
      if (role === 'user' && !agentId && isPrompt(flags)) {
        rememberTitle(recordText(content))
      }
      if (typeof content === 'string') {
        emit(role, { ...flags, ...(content ? { text: content } : {}) }, 0, requestId)
      } else if (!Array.isArray(content) || content.length === 0) {
        emit(role, flags, 0, requestId)
      } else {
        content.forEach((block, part) => {
          const item = asRecord(block)
          const blockType = asString(item?.type)
          if (!item || !blockType) {
            emit('unknown', { type: 'block' }, part, requestId)
            return
          }
          if (blockType === 'text') {
            const text = asString(item.text) ?? ''
            emit(role, { ...flags, ...(text ? { text } : {}) }, part, requestId)
            return
          }
          if (blockType === 'image') {
            const mediaType = asString(asRecord(item.source)?.media_type)
            emit(role, { ...flags, image: true, ...(mediaType ? { mediaType } : {}) }, part, requestId)
            return
          }
          if (blockType === 'fallback') {
            // The response switched models mid-stream (`from.model` → `to.model`).
            const from = asString(asRecord(item.from)?.model)
            const to = asString(asRecord(item.to)?.model)
            emit(
              'system',
              { type: 'fallback', ...(from ? { fromModel: from } : {}), ...(to ? { toModel: to } : {}) },
              part,
              requestId,
            )
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
            if (item.input !== undefined) {
              payload.args = item.input
            }
            emit('tool_call', payload, part, requestId)
            return
          }
          if (blockType === 'tool_result') {
            const payload: Record<string, unknown> = { callId: asString(item.tool_use_id) ?? '' }
            if (item.content !== undefined) {
              payload.output = item.content
            }
            if (typeof item.is_error === 'boolean') {
              payload.isError = item.is_error
            }
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
        const meta = asRecord(rec.compactMetadata)
        const trigger = asString(meta?.trigger)
        const pre = asNumber(meta?.preTokens)
        const post = asNumber(meta?.postTokens)
        const payload: Record<string, unknown> = {}
        if (trigger === 'auto' || trigger === 'manual') {
          payload.trigger = trigger
        }
        if (pre !== undefined) {
          payload.preTokens = pre
        }
        if (post !== undefined) {
          payload.postTokens = post
        }
        emit('compaction', payload, 0)
        continue
      }
      if (subtype === 'turn_duration') {
        const durationMs = asNumber(rec.durationMs)
        emit(
          'system',
          {
            type: 'turn_duration',
            ...(durationMs !== undefined ? { durationMs } : {}),
          },
          0,
        )
        continue
      }
      if (subtype === 'stop_hook_summary' || subtype.includes('hook')) {
        emit('hook', { type: subtype }, 0)
        continue
      }
      const text = asString(rec.content)
      const payload: Record<string, unknown> = { type: subtype, ...(text ? { text } : {}) }
      // `model_refusal_fallback` / `model_refusal_no_fallback`: the API refused and the CLI retried on another model, or did not.
      for (const key of ['originalModel', 'fallbackModel', 'apiRefusalCategory'] as const) {
        const value = asString(rec[key])
        if (value) {
          payload[key] = value
        }
      }
      emit('system', payload, 0)
      continue
    }

    if (type === 'attachment') {
      const attachment = asRecord(rec.attachment)
      const attachmentType = asString(attachment?.type) ?? ''
      if (attachment && attachmentType === 'prompt_snapshot') {
        emit('system', snapshotPayload(attachment, record), 0)
      } else if (attachmentType.startsWith('hook_')) {
        const payload: Record<string, unknown> = { type: attachmentType }
        const name = asString(attachment?.hookName)
        const hookEvent = asString(attachment?.hookEvent)
        const exitCode = asNumber(attachment?.exitCode)
        if (name) {
          payload.name = name
        }
        if (hookEvent) {
          payload.event = hookEvent
        }
        if (exitCode !== undefined) {
          payload.exitCode = exitCode
        }
        emit('hook', payload, 0)
      } else {
        skipRecord(skipped, record, `attachment:${attachmentType || 'record'}`)
      }
      continue
    }

    if (type === 'custom-title') {
      rememberTitle(asString(rec.customTitle), true)
      skipRecord(skipped, record, 'custom-title')
      continue
    }

    if (type === 'ai-title' || type === 'summary') {
      rememberTitle(asString(rec.aiTitle) ?? asString(rec.summary) ?? asString(rec.title))
      skipRecord(skipped, record, type)
      continue
    }

    if (BOOKKEEPING.has(type)) {
      skipRecord(skipped, record, type)
      continue
    }

    emit('unknown', { type }, 0)
  }

  shadowRemoved(events)
  markOrphanToolResults(events)
  assignSeq(events)

  const agents = agentLanes(events, options?.agentMeta)
  const session: Trace['session'] = {
    id: sessionId ?? 'unknown',
    ...(title ? { title } : {}),
    ...(cwd ? { cwd } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
  }
  applySnapshots(events, agents, session)
  return { events, skipped, version, agents, session }
}
