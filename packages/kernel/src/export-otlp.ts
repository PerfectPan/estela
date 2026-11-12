import type { EventOf, Trace, TraceEvent } from '@rivus/estela-schema'
import { spanIdHex, traceIdHex } from './hash-id.ts'
import { laneIds, laneOf, mainAgentId } from './lanes.ts'
import { promptSnapshot } from './prompt-snapshot.ts'
import { reconstruct } from './reconstruct.ts'

/**
 * The semconv version these attributes follow, pinned per the delivery plan: the schema URL
 * of `open-telemetry/semantic-conventions-genai` at implementation time. A semconv release
 * updates this constant and the mapping table together.
 */
export const OTLP_SEMCONV_VERSION = 'gen-ai-dev/1.42.0-dev' as const

export interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}

export interface OtlpAnyValue {
  stringValue?: string
  intValue?: string
  boolValue?: boolean
  arrayValue?: { values: OtlpAnyValue[] }
  kvlistValue?: { values: OtlpKeyValue[] }
}

export interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes?: OtlpKeyValue[]
  status?: { code: number; message?: string }
}

export interface OtlpExportTraceRequest {
  resourceSpans: {
    resource: { attributes: OtlpKeyValue[] }
    scopeSpans: { scope: { name: string }; spans: OtlpSpan[] }[]
  }[]
}

const SPAN_KIND_INTERNAL = 1
const SPAN_KIND_CLIENT = 3
const STATUS_ERROR = 2

const OUTPUT_KINDS = new Set(['assistant', 'reasoning', 'tool_call'])

/** The maps span builders share: event id → its span, request group → its chat span. */
interface SpanMaps {
  spanIdOfEvent: Map<string, string>
  spanIdOfGroup: Map<string, string>
}

/** Epoch milliseconds as OTLP nanoseconds: seconds and milliseconds stay under 2^53 as numbers. */
function unixNano(ms: number): string {
  const whole = Math.max(0, Math.round(ms))
  const seconds = Math.floor(whole / 1000)
  const millis = whole - seconds * 1000
  return `${seconds}${String(millis).padStart(3, '0')}000000`
}

function str(value: string): OtlpAnyValue {
  return { stringValue: value }
}

function json(value: unknown): OtlpAnyValue {
  return { stringValue: JSON.stringify(value) }
}

function int(value: number): OtlpAnyValue {
  return { intValue: String(Math.round(value)) }
}

function kv(key: string, value: OtlpAnyValue): OtlpKeyValue {
  return { key, value }
}

function textParts(text: unknown): Record<string, unknown>[] {
  return typeof text === 'string' ? [{ type: 'text', content: text }] : []
}

function genAiMessage(event: TraceEvent): { role: string; parts: Record<string, unknown>[] } | undefined {
  if (event.kind === 'user') {
    return { role: 'user', parts: textParts(event.payload.text) }
  }
  if (event.kind === 'assistant') {
    return { role: 'assistant', parts: textParts(event.payload.text) }
  }
  if (event.kind === 'system') {
    return typeof event.payload.text === 'string' ? { role: 'system', parts: textParts(event.payload.text) } : undefined
  }
  if (event.kind === 'reasoning') {
    return {
      role: 'assistant',
      parts: typeof event.payload.text === 'string' ? [{ type: 'reasoning', content: event.payload.text }] : [],
    }
  }
  if (event.kind === 'tool_call') {
    return {
      role: 'assistant',
      parts: [
        {
          type: 'tool_call',
          id: event.payload.callId,
          name: event.payload.name,
          arguments: event.payload.args ?? null,
        },
      ],
    }
  }
  if (event.kind === 'tool_result') {
    return {
      role: 'tool',
      parts: [{ type: 'tool_call_response', id: event.payload.callId, response: event.payload.output ?? null }],
    }
  }
  return undefined
}

/** The events the request produced: its group's assistant, reasoning, and tool-call events. */
function outputMessages(
  trace: Trace,
  event: EventOf<'request'>,
  laneId: string,
): { role: string; parts: Record<string, unknown>[] }[] {
  if (event.requestId === undefined) {
    return []
  }
  const mainId = mainAgentId(trace)
  const parts: { role: string; parts: Record<string, unknown>[] }[] = []
  for (const item of trace.events) {
    if (item.id === event.id || laneOf(item, mainId) !== laneId || item.requestId !== event.requestId) {
      continue
    }
    if (!OUTPUT_KINDS.has(item.kind)) {
      continue
    }
    if (item.kind === 'tool_call') {
      const callPart = {
        type: 'tool_call',
        id: item.payload.callId,
        name: item.payload.name,
        arguments: item.payload.args ?? null,
      }
      const last = parts[parts.length - 1]
      if (last !== undefined && last.role === 'assistant') {
        last.parts.push(callPart)
      } else {
        parts.push({ role: 'assistant', parts: [callPart] })
      }
      continue
    }
    const message = genAiMessage(item)
    if (message !== undefined && message.parts.length > 0) {
      parts.push(message)
    }
  }
  return parts
}

/** The `system` slot's prompt: its snapshot's text, or the session/lane field the slot fell back to. */
function systemPromptOf(
  trace: Trace,
  laneId: string,
  slot: { status: string; recordedBy?: string } | undefined,
  byId: Map<string, TraceEvent>,
): string | undefined {
  if (slot === undefined || slot.status === 'unavailable') {
    return undefined
  }
  if (slot.recordedBy !== undefined) {
    const snapshotEvent = byId.get(slot.recordedBy)
    const snapshot = snapshotEvent !== undefined ? promptSnapshot(snapshotEvent) : undefined
    return snapshot?.systemPrompt
  }
  return laneId === mainAgentId(trace)
    ? trace.session.systemPrompt
    : trace.agents.find(lane => lane.id === laneId)?.systemPrompt
}

/** The `tools` slot's definitions: its snapshot's list, or the session field. */
function toolsOf(
  trace: Trace,
  slot: { status: string; recordedBy?: string } | undefined,
  byId: Map<string, TraceEvent>,
): unknown[] | undefined {
  if (slot === undefined || slot.status === 'unavailable') {
    return undefined
  }
  if (slot.recordedBy !== undefined) {
    const snapshotEvent = byId.get(slot.recordedBy)
    const snapshot = snapshotEvent !== undefined ? promptSnapshot(snapshotEvent) : undefined
    return snapshot?.tools
  }
  return Array.isArray(trace.session.tools) ? trace.session.tools : undefined
}

function usageAttributes(usage: EventOf<'request'>['payload']['usage']): OtlpKeyValue[] {
  if (usage === undefined) {
    return []
  }
  return [
    ...(usage.inputTokens !== undefined ? [kv('gen_ai.usage.input_tokens', int(usage.inputTokens))] : []),
    ...(usage.outputTokens !== undefined ? [kv('gen_ai.usage.output_tokens', int(usage.outputTokens))] : []),
    ...(usage.cacheReadTokens !== undefined
      ? [kv('gen_ai.usage.cache_read.input_tokens', int(usage.cacheReadTokens))]
      : []),
    ...(usage.cacheWriteTokens !== undefined
      ? [kv('gen_ai.usage.cache_write.input_tokens', int(usage.cacheWriteTokens))]
      : []),
    ...(usage.reasoningTokens !== undefined
      ? [kv('gen_ai.usage.reasoning.output_tokens', int(usage.reasoningTokens))]
      : []),
  ]
}

/** The model-visible surface at a request, as the pinned semconv's message attributes. */
function messageAttributes(
  trace: Trace,
  event: EventOf<'request'>,
  laneId: string,
  messages: ReturnType<typeof reconstruct>,
  byId: Map<string, TraceEvent>,
): OtlpKeyValue[] {
  const attributes: OtlpKeyValue[] = []
  const inputMessages: unknown[] = []
  for (const id of messages.visibleIds) {
    const visible = byId.get(id)
    if (visible === undefined) {
      continue
    }
    // The request's own output group is the output, not the input, of this call.
    if (event.requestId !== undefined && visible.requestId === event.requestId) {
      continue
    }
    const message = genAiMessage(visible)
    if (message !== undefined) {
      inputMessages.push(message)
    }
  }
  if (inputMessages.length > 0) {
    attributes.push(kv('gen_ai.input.messages', json(inputMessages)))
  }
  const output = outputMessages(trace, event, laneId)
  if (output.length > 0) {
    attributes.push(kv('gen_ai.output.messages', json(output)))
  }
  const systemSlot = messages.slots?.find(slot => slot.name === 'system')
  const systemPrompt = systemPromptOf(trace, laneId, systemSlot, byId)
  if (systemPrompt !== undefined) {
    attributes.push(kv('gen_ai.system_instructions', json([{ type: 'text', content: systemPrompt }])))
  }
  const toolsSlot = messages.slots?.find(slot => slot.name === 'tools')
  const tools = toolsOf(trace, toolsSlot, byId)
  if (tools !== undefined) {
    attributes.push(kv('gen_ai.tool.definitions', json(tools)))
  }
  const compacted = trace.events.some(
    item => item.kind === 'compaction' && laneOf(item, mainAgentId(trace)) === laneId && item.seq < event.seq,
  )
  if (compacted) {
    attributes.push(kv('gen_ai.conversation.compacted', { boolValue: true }))
  }
  return attributes
}

/** One model call: the request payload's attributes plus the model-visible surface at it. */
function chatSpan(
  trace: Trace,
  event: EventOf<'request'>,
  laneId: string,
  rootSpanId: string,
  traceId: string,
  maps: SpanMaps,
): OtlpSpan {
  const payload = event.payload
  const spanId = spanIdHex(`request:${trace.agent}\0${event.id}`)
  maps.spanIdOfEvent.set(event.id, spanId)
  if (event.requestId !== undefined && !maps.spanIdOfGroup.has(`${laneId}\0${event.requestId}`)) {
    maps.spanIdOfGroup.set(`${laneId}\0${event.requestId}`, spanId)
  }
  const start = payload.startedAt ?? event.ts
  const end = payload.durationMs !== undefined ? start + payload.durationMs : start
  const messages = reconstruct(trace, event.id)
  const byId = new Map(trace.events.map(item => [item.id, item]))
  const attributes = [
    kv('gen_ai.operation.name', str('chat')),
    ...(payload.model !== undefined ? [kv('gen_ai.request.model', str(payload.model))] : []),
    ...(payload.responseId !== undefined ? [kv('gen_ai.response.id', str(payload.responseId))] : []),
    ...(payload.finishReason !== undefined
      ? [kv('gen_ai.response.finish_reasons', { arrayValue: { values: [str(payload.finishReason)] } })]
      : []),
    ...usageAttributes(payload.usage),
    ...messageAttributes(trace, event, laneId, messages, byId),
  ]
  return {
    traceId,
    spanId,
    parentSpanId: rootSpanId,
    name: payload.model !== undefined ? `chat ${payload.model}` : 'chat',
    kind: SPAN_KIND_CLIENT,
    startTimeUnixNano: unixNano(start),
    endTimeUnixNano: unixNano(end),
    attributes,
  }
}

/** One tool execution: the call's attributes and, when it has one, its result and error status. */
function toolSpan(
  event: EventOf<'tool_call'>,
  laneEvents: TraceEvent[],
  laneId: string,
  rootSpanId: string,
  traceId: string,
  maps: SpanMaps,
): OtlpSpan {
  const payload = event.payload
  const parentSpanId =
    (event.requestId !== undefined ? maps.spanIdOfGroup.get(`${laneId}\0${event.requestId}`) : undefined) ?? rootSpanId
  const result = laneEvents.find(
    item => item.kind === 'tool_result' && item.payload.callId === payload.callId && item.seq > event.seq,
  )
  const errorStatus =
    result?.kind === 'tool_result' && result.payload.isError === true
      ? {
          code: STATUS_ERROR,
          ...(typeof result.payload.output === 'string' ? { message: result.payload.output } : {}),
        }
      : undefined
  const attributes = [
    kv('gen_ai.operation.name', str('execute_tool')),
    kv('gen_ai.tool.name', str(payload.name)),
    kv('gen_ai.tool.call.id', str(payload.callId)),
    ...(payload.args !== undefined ? [kv('gen_ai.tool.call.arguments', json(payload.args))] : []),
    ...(result !== undefined && result.kind === 'tool_result' && result.payload.output !== undefined
      ? [kv('gen_ai.tool.call.result', json(result.payload.output))]
      : []),
  ]
  const spanId = spanIdHex(`tool:${event.id}`)
  maps.spanIdOfEvent.set(event.id, spanId)
  return {
    traceId,
    spanId,
    parentSpanId,
    name: `execute_tool ${payload.name}`,
    kind: SPAN_KIND_CLIENT,
    startTimeUnixNano: unixNano(event.ts),
    endTimeUnixNano: unixNano(result?.ts ?? event.ts),
    attributes,
    ...(errorStatus !== undefined ? { status: errorStatus } : {}),
  }
}

/**
 * The canonical trace as one OTLP/JSON `ExportTraceServiceRequest` (OTLP JSON encoding:
 * integer enums, hex ids, nanosecond times as strings), with the OpenTelemetry GenAI
 * attributes of the pinned semconv version: one `invoke_agent` span per agent lane, one
 * `chat` span per model request carrying the request, usage, and model-visible message
 * attributes, and one `execute_tool` span per tool call.
 */
export function toOtlp(trace: Trace): OtlpExportTraceRequest {
  const mainId = mainAgentId(trace)
  const traceId = traceIdHex(`${trace.agent}\0${trace.session.id}`)
  const spans: OtlpSpan[] = []
  const maps: SpanMaps = { spanIdOfEvent: new Map(), spanIdOfGroup: new Map() }
  const spanIdOfLane = new Map<string, string>()

  const laneIdList = laneIds(trace)
  for (const laneId of laneIdList) {
    const laneEvents = trace.events.filter(event => laneOf(event, mainId) === laneId)
    if (laneEvents.length === 0) {
      continue
    }
    const lane = trace.agents.find(agent => agent.id === laneId)
    const isMain = laneId === mainId
    const parentLaneId = isMain ? undefined : lane?.parentId
    const parentSpanId =
      (lane?.spawnEventId !== undefined ? maps.spanIdOfEvent.get(lane.spawnEventId) : undefined)
      ?? (parentLaneId !== undefined ? spanIdOfLane.get(parentLaneId) : undefined)
      ?? (isMain ? undefined : spanIdOfLane.get(mainId))
    const agentName = isMain ? trace.agent : (lane?.title ?? laneId)
    const rootSpan: OtlpSpan = {
      traceId,
      spanId: spanIdHex(`lane:${trace.agent}\0${laneId}`),
      ...(parentSpanId !== undefined ? { parentSpanId } : {}),
      name: `invoke_agent ${agentName}`,
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: unixNano(laneEvents[0]!.ts),
      endTimeUnixNano: unixNano(laneEvents[laneEvents.length - 1]!.ts),
      attributes: [
        kv('gen_ai.operation.name', str('invoke_agent')),
        kv('gen_ai.agent.name', str(agentName)),
        ...(trace.agentVersion !== undefined ? [kv('gen_ai.agent.version', str(trace.agentVersion))] : []),
        kv('gen_ai.conversation.id', str(trace.session.id)),
      ],
    }
    spanIdOfLane.set(laneId, rootSpan.spanId)
    spans.push(rootSpan)

    // Requests first, so a tool span can name its request's chat span as parent.
    for (const event of laneEvents) {
      if (event.kind === 'request') {
        spans.push(chatSpan(trace, event, laneId, rootSpan.spanId, traceId, maps))
      }
    }
    for (const event of laneEvents) {
      if (event.kind === 'tool_call') {
        spans.push(toolSpan(event, laneEvents, laneId, rootSpan.spanId, traceId, maps))
      }
    }
  }

  return {
    resourceSpans: [
      {
        resource: { attributes: [kv('service.name', str('estela'))] },
        scopeSpans: [{ scope: { name: 'estela' }, spans }],
      },
    ],
  }
}
