import type { Adapter, TraceIO } from '@rivus/agent-trace-kernel'
import type { EventKind, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { asRecord, asString, basenamePath, dirnamePath, joinPath, parseTime, readJsonl } from '@rivus/agent-trace-kernel'
import { TRACE_SCHEMA } from '@rivus/agent-trace-schema'

function sessionDir(path: string): string {
  return basenamePath(path) === 'updates.jsonl' ? dirnamePath(path) : path
}

function chunkText(content: unknown): string {
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

export function parseGrokUpdates(rows: unknown[], extras?: {
  sessionId?: string
  cwd?: string
  title?: string
  systemPrompt?: string
  tools?: unknown
}): Trace {
  const events: TraceEvent[] = []
  let n = 0
  const push = (kind: EventKind, ts: number, payload: Record<string, unknown>, original: unknown): void => {
    events.push({ id: `e${n++}`, ts, kind, payload, original })
  }

  if (extras?.systemPrompt) {
    const payload: Record<string, unknown> = { text: extras.systemPrompt }
    if (extras.tools != null)
      payload.tools = extras.tools
    push('system', 0, payload, { type: 'system_prompt' })
  }

  let pending: { kind: EventKind, text: string, ts: number, originals: unknown[] } | undefined
  const flush = (): void => {
    if (!pending)
      return
    push(pending.kind, pending.ts, { text: pending.text }, pending.originals)
    pending = undefined
  }

  for (const row of rows) {
    const rec = asRecord(row)
    const params = asRecord(rec?.params)
    const update = asRecord(params?.update) ?? {}
    const ts = parseTime(rec?.timestamp)
    const kind = asString(update.sessionUpdate)

    if (kind === 'user_message_chunk' || kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
      const mapped: EventKind = kind === 'user_message_chunk'
        ? 'user'
        : kind === 'agent_thought_chunk' ? 'thinking' : 'assistant'
      const text = chunkText(update.content)
      if (pending && pending.kind === mapped) {
        pending.text += text
        pending.originals.push(row)
      }
      else {
        flush()
        pending = { kind: mapped, text, ts, originals: [row] }
      }
      continue
    }
    flush()

    if (kind === 'tool_call') {
      push('tool_call', ts, {
        name: asString(update.title),
        callId: asString(update.toolCallId),
        args: update.rawInput,
      }, row)
      continue
    }
    if (kind === 'tool_call_update' && asString(update.status) === 'completed') {
      push('tool_result', ts, {
        callId: asString(update.toolCallId),
        text: chunkText(update.content),
      }, row)
      continue
    }
    if (kind === 'tool_call_update')
      continue

    push('unknown', ts, { type: kind ?? 'update' }, row)
  }
  flush()

  return {
    schema: TRACE_SCHEMA,
    host: 'grok',
    session: {
      id: extras?.sessionId ?? 'unknown',
      cwd: extras?.cwd,
      title: extras?.title,
    },
    events,
  }
}

export const grokAdapter: Adapter = {
  id: 'grok',
  async detect(path: string, io: TraceIO): Promise<boolean> {
    const dir = sessionDir(path)
    try {
      const st = await io.stat(joinPath(dir, 'summary.json'))
      const up = await io.stat(joinPath(dir, 'updates.jsonl'))
      return st?.kind === 'file' && up?.kind === 'file'
    }
    catch {
      return false
    }
  },
  async load(path: string, io: TraceIO): Promise<Trace> {
    const dir = sessionDir(path)
    const summary = asRecord(JSON.parse(await io.readText(joinPath(dir, 'summary.json'))))
    const info = asRecord(summary?.info)
    let systemPrompt: string | undefined
    let tools: unknown
    try {
      systemPrompt = await io.readText(joinPath(dir, 'system_prompt.txt'))
    }
    catch { /* optional */ }
    try {
      tools = JSON.parse(await io.readText(joinPath(dir, 'tool_definitions.json'))) as unknown
    }
    catch { /* optional */ }
    return parseGrokUpdates(await readJsonl(joinPath(dir, 'updates.jsonl'), io), {
      sessionId: asString(info?.id) ?? asString(summary?.id) ?? basenamePath(dir),
      cwd: asString(info?.cwd),
      title: asString(summary?.title) ?? asString(summary?.session_summary),
      systemPrompt,
      tools,
    })
  },
}
