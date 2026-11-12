import type { TraceEvent } from '@rivus/estela-schema'
import type { Entry, LedgerModel } from '@/lib/ledger-model.ts'
import { pretty, rowLine } from '@/lib/event-text.ts'

type Lookup = (id: string) => TraceEvent | undefined

function without(payload: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (!keys.includes(key) && key !== '$truncated') {
      out[key] = value
    }
  }
  return out
}

/** Normalized fields of the selected row's main event, as the "Input" tab shows them. */
export function inputText(entry: Entry, primary: TraceEvent | undefined, lookup: Lookup): string {
  if (entry.type === 'hooks') {
    return entry.eventIds.map(id => pretty(lookup(id)?.payload)).join('\n\n')
  }
  if (!primary) {
    return ''
  }
  switch (primary.kind) {
    case 'tool_call':
      return pretty(primary.payload.args)
    case 'user':
    case 'assistant':
    case 'reasoning':
      return primary.payload.text ?? pretty(without(primary.payload))
    default:
      return pretty(without(primary.payload))
  }
}

/** The result side: a tool's output, a request's events, a compaction's summary. */
export function outputText(
  entry: Entry,
  primary: TraceEvent | undefined,
  result: TraceEvent | undefined,
  model: LedgerModel,
  lookup: Lookup,
): string {
  if (result) {
    const flags = without(result.payload, 'output', 'callId')
    const head = Object.keys(flags).length > 0 ? `${pretty(flags)}\n\n` : ''
    return `${head}${pretty(result.payload.output)}`
  }
  if (!primary) {
    return ''
  }
  const request = model.requests.get(primary.id)?.entry
  if (request) {
    return request.eventIds
      .map(id => {
        const event = lookup(id) ?? model.byId.get(id)
        return event ? `[${event.kind}] ${rowLine(event)}` : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (primary.kind === 'compaction') {
    const summaryId = primary.payload.summaryEventId
    const summary = summaryId ? lookup(summaryId) : undefined
    return pretty(summary?.payload.text)
  }
  if (entry.type === 'event' && primary.kind === 'tool_result') {
    return pretty(primary.payload.output)
  }
  return ''
}
