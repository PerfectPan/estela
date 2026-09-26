import type { Adapter, TraceIO } from '@rivus/agent-trace-kernel'
import type { EventKind, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { DatabaseSync } from 'node:sqlite'
import { asRecord, asString, basenamePath, parseTime, splitSessionRef } from '@rivus/agent-trace-kernel'
import { TRACE_SCHEMA } from '@rivus/agent-trace-schema'

export interface OpenCodeMessage {
  id: string
  time: number
  role?: string
  parentId?: string
  agent?: string
  data: Record<string, unknown>
}

export interface OpenCodePart {
  id: string
  messageId: string
  time: number
  data: Record<string, unknown>
}

export function parseOpenCodeSession(input: {
  sessionId: string
  cwd?: string
  title?: string
  messages: OpenCodeMessage[]
  parts: OpenCodePart[]
}): Trace {
  const events: TraceEvent[] = []
  const messages = new Map(input.messages.map(m => [m.id, m]))

  for (const part of input.parts) {
    const type = asString(part.data.type)
    const msg = messages.get(part.messageId)
    const ts = part.time || msg?.time || 0
    let kind: EventKind = 'unknown'
    const payload: Record<string, unknown> = {}

    if (type === 'text') {
      kind = msg?.role === 'user' ? 'user' : 'assistant'
      payload.text = asString(part.data.text)
    }
    else if (type === 'reasoning') {
      kind = 'thinking'
      payload.text = asString(part.data.text)
    }
    else if (type === 'tool') {
      const state = asRecord(part.data.state)
      const status = asString(state?.status)
      if (status === 'completed' || state?.output != null) {
        kind = 'tool_result'
        payload.name = asString(part.data.tool)
        payload.callId = asString(part.data.callID)
        payload.output = state?.output
      }
      else {
        kind = 'tool_call'
        payload.name = asString(part.data.tool)
        payload.callId = asString(part.data.callID)
        payload.args = state?.input
      }
    }
    else if (type === 'compaction') {
      kind = 'compaction'
      payload.auto = part.data.auto
      payload.tailStartId = part.data.tail_start_id
    }
    else if (type === 'step-start' || type === 'step-finish' || type === 'patch') {
      kind = 'unknown'
      payload.type = type
    }

    events.push({
      id: part.id,
      ts,
      kind,
      parentId: msg?.parentId,
      agentId: msg?.agent,
      payload,
      original: part.data,
    })
  }

  return {
    schema: TRACE_SCHEMA,
    host: 'opencode',
    session: { id: input.sessionId, cwd: input.cwd, title: input.title },
    events,
  }
}

function parseData(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string')
    return asRecord(JSON.parse(raw)) ?? {}
  return asRecord(raw) ?? {}
}

export const opencodeAdapter: Adapter = {
  id: 'opencode',
  async detect(path: string, io: TraceIO): Promise<boolean> {
    const { file } = splitSessionRef(path)
    if (basenamePath(file) === 'opencode.db')
      return true
    try {
      const buf = await io.readBytes(file, { start: 0, end: 16 })
      return new TextDecoder().decode(buf).startsWith('SQLite format 3')
    }
    catch {
      return false
    }
  },
  async load(path: string): Promise<Trace> {
    const { file, sessionId: fromHash } = splitSessionRef(path)
    const sessionId = fromHash ?? process.env.AGENT_TRACE_SESSION
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      const sessions = db.prepare('SELECT id, directory, title FROM session').all() as {
        id: string
        directory: string | null
        title: string | null
      }[]
      const id = sessionId ?? (sessions.length === 1 ? sessions[0].id : undefined)
      if (!id) {
        throw new Error(`opencode db has ${sessions.length} sessions; pass path#sessionId or AGENT_TRACE_SESSION`)
      }
      const session = sessions.find(s => s.id === id)
      if (!session)
        throw new Error(`opencode session ${id} not in ${file}`)

      const messageRows = db.prepare(
        'SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created',
      ).all(id) as { id: string, time_created: number, data: string }[]
      const partRows = db.prepare(
        'SELECT id, message_id, time_created, data FROM part WHERE session_id = ? ORDER BY time_created',
      ).all(id) as { id: string, message_id: string, time_created: number, data: string }[]

      const messages: OpenCodeMessage[] = messageRows.map((row) => {
        const data = parseData(row.data)
        return {
          id: row.id,
          time: parseTime(row.time_created),
          role: asString(data.role),
          parentId: asString(data.parentID),
          agent: asString(data.agent),
          data,
        }
      })
      const parts: OpenCodePart[] = partRows.map(row => ({
        id: row.id,
        messageId: row.message_id,
        time: parseTime(row.time_created),
        data: parseData(row.data),
      }))

      return parseOpenCodeSession({
        sessionId: id,
        cwd: session.directory ?? undefined,
        title: session.title ?? undefined,
        messages,
        parts,
      })
    }
    finally {
      db.close()
    }
  },
}
