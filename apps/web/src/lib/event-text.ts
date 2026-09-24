import type { TraceEvent } from '@rivus/agent-trace-schema'
import { previewText, previewUnknown } from './preview.ts'

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** `payload.$truncated` from `toView`: this event has strings the view shortened (S12). */
export function isShortened(event: TraceEvent | undefined): boolean {
  const paths = event?.payload.$truncated
  return Array.isArray(paths) && paths.length > 0
}

/** Argument keys that name what a tool call acts on, in the order they are tried. */
const TARGET_KEYS = ['command', 'cmd', 'file_path', 'filePath', 'path', 'pattern', 'query', 'url', 'description', 'prompt']

/** The one argument that says what a tool call acts on (a path, a command), or a JSON preview. */
export function toolTarget(args: unknown): string {
  if (typeof args === 'string')
    return previewText(args)
  const record = asRecord(args)
  if (record) {
    for (const key of TARGET_KEYS) {
      const value = record[key]
      if (typeof value === 'string' && value.trim())
        return previewText(value)
      if (Array.isArray(value) && value.every(item => typeof item === 'string'))
        return previewText(value.join(' '))
    }
  }
  return previewUnknown(args)
}

export function toolName(event: TraceEvent): string {
  return asText(event.payload.name) || 'tool'
}

export interface RowText {
  /** Plain text, in the body font. */
  text?: string
  /** A command or a path, in the data font. */
  mono?: string
  /** Muted text (thinking). */
  muted?: boolean
}

/** One-line content of a ledger row. Session text is shown as recorded. */
export function rowText(event: TraceEvent): RowText {
  const payload = event.payload
  switch (event.kind) {
    case 'tool_call':
      return { text: toolName(event), mono: toolTarget(payload.args) }
    case 'tool_result':
      return { text: previewUnknown(payload.output ?? payload.text) }
    case 'request': {
      const model = asText(payload.model)
      const stop = asText(payload.stopReason)
      return { text: [model, stop ? `stop ${stop}` : ''].filter(Boolean).join(' · ') }
    }
    case 'thinking':
      return { text: previewText(asText(payload.text)), muted: true }
    case 'hook':
      return { text: asText(payload.name) || asText(payload.event) || asText(payload.type) || 'hook' }
    case 'compaction':
      return { text: previewUnknown(payload.summary) }
    default: {
      const text = asText(payload.text)
      return { text: text ? previewText(text) : previewUnknown(payload.type ?? payload) }
    }
  }
}

export interface RequestNumbers {
  model?: string
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  stopReason?: string
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Recorded fields of a `request` event; a field the host did not record is absent. */
export function requestNumbers(event: TraceEvent): RequestNumbers {
  const usage = asRecord(event.payload.usage)
  const out: RequestNumbers = {}
  const model = asText(event.payload.model)
  if (model)
    out.model = model
  const input = asNumber(usage?.inputTokens)
  if (input !== undefined)
    out.inputTokens = input
  const output = asNumber(usage?.outputTokens)
  if (output !== undefined)
    out.outputTokens = output
  const duration = asNumber(event.payload.durationMs)
  if (duration !== undefined)
    out.durationMs = duration
  const stop = asText(event.payload.stopReason)
  if (stop)
    out.stopReason = stop
  return out
}

export function numberField(event: TraceEvent | undefined, key: string): number | undefined {
  return event ? asNumber(event.payload[key]) : undefined
}

/** The text an inspector tab shows for a value: strings as recorded, anything else as indented JSON. */
export function pretty(value: unknown): string {
  if (value == null)
    return ''
  if (typeof value === 'string')
    return value
  try {
    return JSON.stringify(value, (key, inner: unknown) => key === '$truncated' ? undefined : inner, 2)
  }
  catch {
    // JSON.stringify threw (a BigInt or a cycle); String() is the last resort.
    // oxlint-disable-next-line typescript/no-base-to-string
    return String(value)
  }
}
