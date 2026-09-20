import type { Adapter } from '@agent-trace/kernel'
import type { EventKind, Trace, TraceEvent } from '@agent-trace/schema'
import { basename } from 'node:path'
import { asRecord, asString, parseTime, readJsonl } from '@agent-trace/kernel'
import { TRACE_SCHEMA } from '@agent-trace/schema'

const SKIP = new Set(['token_count', 'turn_context'])

function textFromContent(content: unknown): string | undefined {
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
  return parts.length ? parts.join('') : undefined
}

export function parseCodexRows(rows: unknown[]): Trace {
  const events: TraceEvent[] = []
  let sessionId = 'unknown'
  let cwd: string | undefined
  let title: string | undefined

  rows.forEach((row, index) => {
    const rec = asRecord(row)
    if (!rec)
      return
    const envelopeType = asString(rec.type)
    const payload = asRecord(rec.payload) ?? {}
    const ts = parseTime(rec.timestamp ?? payload.timestamp)
    const id = String(rec.ordinal ?? index)

    if (envelopeType === 'session_meta') {
      sessionId = asString(payload.session_id) ?? asString(payload.id) ?? sessionId
      cwd = asString(payload.cwd) ?? cwd
      return
    }

    if (envelopeType === 'turn_context')
      return

    if (envelopeType === 'event_msg') {
      const inner = asString(payload.type)
      if (!inner || SKIP.has(inner))
        return
      events.push({
        id: `e${id}`,
        ts,
        kind: 'unknown',
        payload: { type: inner },
        original: rec,
      })
      return
    }

    if (envelopeType !== 'response_item') {
      events.push({
        id: `e${id}`,
        ts,
        kind: 'unknown',
        payload: { type: envelopeType ?? 'unknown' },
        original: rec,
      })
      return
    }

    const inner = asString(payload.type)
    let kind: EventKind = 'unknown'
    const body: Record<string, unknown> = {}

    if (inner === 'message') {
      const role = asString(payload.role)
      kind = role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'unknown'
      const text = textFromContent(payload.content)
      if (text)
        body.text = text
      if (!title && kind === 'user' && text)
        title = text.slice(0, 80)
    }
    else if (inner === 'reasoning') {
      kind = 'thinking'
      const summary = payload.summary
      if (Array.isArray(summary) && summary[0]) {
        const first = asRecord(summary[0])
        const text = asString(first?.text)
        if (text)
          body.text = text
      }
    }
    else if (inner === 'function_call' || inner === 'custom_tool_call') {
      kind = 'tool_call'
      body.name = asString(payload.name)
      body.callId = asString(payload.call_id)
      body.args = payload.arguments ?? payload.input
    }
    else if (inner === 'function_call_output' || inner === 'custom_tool_call_output') {
      kind = 'tool_result'
      body.callId = asString(payload.call_id)
      body.text = asString(payload.output) ?? textFromContent(payload.output)
    }

    events.push({ id: `e${id}`, ts, kind, payload: body, original: rec })
  })

  return {
    schema: TRACE_SCHEMA,
    host: 'codex',
    session: { id: sessionId, cwd, title },
    events,
  }
}

export const codexAdapter: Adapter = {
  id: 'codex',
  async detect(path: string): Promise<boolean> {
    const name = basename(path)
    if (name.startsWith('rollout-') && name.endsWith('.jsonl'))
      return true
    if (!name.endsWith('.jsonl'))
      return false
    const rows = await readJsonl(path)
    const first = asRecord(rows[0])
    return asString(first?.type) === 'session_meta'
  },
  async load(path: string): Promise<Trace> {
    return parseCodexRows(await readJsonl(path))
  },
}
