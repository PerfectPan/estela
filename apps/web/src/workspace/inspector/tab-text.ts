import type { TraceEvent } from '@rivus/agent-trace-schema'
import type { Entry, LedgerModel } from '@/lib/ledger-model.ts'
import { pretty, rowText } from '@/lib/event-text.ts'

type Lookup = (id: string) => TraceEvent | undefined

function without(payload: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (!keys.includes(key) && key !== '$truncated')
      out[key] = value
  }
  return out
}

/** Normalized fields of the selected row's main event, as the "Input" tab shows them. */
export function inputText(entry: Entry, primary: TraceEvent | undefined, lookup: Lookup): string {
  if (entry.type === 'hooks')
    return entry.eventIds.map(id => pretty(lookup(id)?.payload)).join('\n\n')
  if (!primary)
    return ''
  const payload = primary.payload
  switch (primary.kind) {
    case 'tool_call':
      return pretty(payload.args)
    case 'user':
    case 'assistant':
    case 'thinking':
      return typeof payload.text === 'string' ? payload.text : pretty(without(payload))
    default:
      return pretty(without(payload))
  }
}

/** The result side: a tool's output, a request's events, a compaction's summary. */
export function outputText(entry: Entry, primary: TraceEvent | undefined, result: TraceEvent | undefined, model: LedgerModel, lookup: Lookup): string {
  if (result) {
    const output = result.payload.output ?? result.payload.text
    const flags = without(result.payload, 'output', 'text', 'callId')
    const head = Object.keys(flags).length > 0 ? `${pretty(flags)}\n\n` : ''
    return `${head}${pretty(output)}`
  }
  if (!primary)
    return ''
  if (primary.kind === 'request' && primary.requestId) {
    const lines: string[] = []
    for (const event of model.trace.events) {
      if (event.requestId !== primary.requestId || event.id === primary.id)
        continue
      const text = rowText(lookup(event.id) ?? event)
      lines.push(`[${event.kind}] ${[text.text, text.mono].filter(Boolean).join('  ')}`)
    }
    return lines.join('\n')
  }
  if (primary.kind === 'compaction') {
    const summaryId = typeof primary.payload.summaryEventId === 'string' ? primary.payload.summaryEventId : undefined
    const summary = summaryId ? lookup(summaryId) : undefined
    return pretty(summary?.payload.text ?? primary.payload.summary)
  }
  if (entry.type === 'event' && primary.kind === 'tool_result')
    return pretty(primary.payload.output ?? primary.payload.text)
  return ''
}
