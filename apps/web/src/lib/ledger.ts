import type { EventKind, Trace, TraceEvent } from '@rivus/agent-trace-schema'
import { previewText, previewUnknown } from './preview.ts'

export type LedgerKind =
  | 'system'
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'compacted'
  | 'unknown'

export const KIND_LABEL: Record<LedgerKind, string> = {
  system: 'SYSTEM',
  user: 'USER',
  assistant: 'ASSISTANT',
  thinking: 'THINK',
  tool: 'TOOL',
  compacted: 'COMPACTED',
  unknown: 'UNKNOWN',
}

export interface LedgerRow {
  id: string
  index: number
  kind: LedgerKind
  preview: string
  resultPreview?: string
  name?: string
  eventIds: string[]
  shadowed: boolean
  ts: number
}

export interface LedgerSection {
  turn: number | null
  title: string
  rows: LedgerRow[]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function callId(event: TraceEvent): string | undefined {
  const id = event.payload.callId
  return typeof id === 'string' ? id : undefined
}

function displayKind(kind: EventKind): LedgerKind {
  if (kind === 'tool_call' || kind === 'tool_result')
    return 'tool'
  if (kind === 'compaction')
    return 'compacted'
  if (kind === 'system' || kind === 'user' || kind === 'assistant' || kind === 'thinking' || kind === 'unknown')
    return kind
  return 'unknown'
}

function eventPreview(event: TraceEvent): string {
  const text = asText(event.payload.text)
  if (text)
    return previewText(text)
  if (event.kind === 'tool_call') {
    const name = asText(event.payload.name) || 'tool'
    const args = event.payload.args
    const argText = args === undefined ? '' : previewUnknown(args)
    return argText ? `${name}  ${argText}` : name
  }
  if (event.kind === 'tool_result')
    return previewUnknown(event.payload.output ?? event.payload.text)
  if (event.kind === 'compaction')
    return previewUnknown(event.payload.summary ?? event.payload)
  return previewUnknown(event.payload.type ?? event.kind)
}

export function buildLedger(trace: Trace): LedgerSection[] {
  const used = new Set<string>()
  const rows: LedgerRow[] = []
  const byCall = new Map<string, TraceEvent>()
  for (const event of trace.events) {
    if (event.kind === 'tool_result' && callId(event))
      byCall.set(callId(event)!, event)
  }

  for (const event of trace.events) {
    if (used.has(event.id))
      continue
    if (event.kind === 'tool_call') {
      const id = callId(event)
      const result = id ? byCall.get(id) : undefined
      if (result)
        used.add(result.id)
      rows.push({
        id: event.id,
        index: rows.length + 1,
        kind: 'tool',
        preview: eventPreview(event),
        resultPreview: result ? eventPreview(result) : undefined,
        name: asText(event.payload.name) || undefined,
        eventIds: result ? [event.id, result.id] : [event.id],
        shadowed: Boolean(event.shadowedBy || result?.shadowedBy),
        ts: event.ts,
      })
      continue
    }
    if (event.kind === 'tool_result' && used.has(event.id))
      continue
    rows.push({
      id: event.id,
      index: rows.length + 1,
      kind: displayKind(event.kind),
      preview: eventPreview(event),
      eventIds: [event.id],
      shadowed: Boolean(event.shadowedBy),
      ts: event.ts,
    })
  }

  const sections: LedgerSection[] = []
  let turn = 0
  let current: LedgerSection | undefined
  for (const row of rows) {
    if (row.kind === 'user') {
      turn += 1
      current = { turn, title: `Turn ${turn}`, rows: [row] }
      sections.push(current)
      continue
    }
    if (row.kind === 'compacted' && current === undefined) {
      sections.push({ turn: null, title: 'Between turns', rows: [row] })
      continue
    }
    if (!current) {
      current = { turn: null, title: 'Between turns', rows: [] }
      sections.push(current)
    }
    current.rows.push(row)
  }
  return sections
}

export function formatClock(ts: number): string {
  if (!ts)
    return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime()))
    return ''
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
}
