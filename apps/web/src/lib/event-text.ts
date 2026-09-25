import type { TraceEvent } from '@rivus/agent-trace-schema'
import { asNumber, asRecord, asString } from '@rivus/agent-trace-kernel'
import { translate as t } from '@/i18n/locale.ts'
import { escapeBidi, previewText, previewUnknown } from './preview.ts'

/** `payload.$truncated` from `toView`: this event has strings the view shortened (S12). */
export function isShortened(event: TraceEvent | undefined): boolean {
  const paths = event?.payload.$truncated
  return Array.isArray(paths) && paths.length > 0
}

/** Argument keys that name what a tool call acts on, in the order they are tried. */
const TARGET_KEYS = ['command', 'cmd', 'file_path', 'filePath', 'path', 'pattern', 'query', 'url', 'description', 'prompt']

/** The one argument that says what a tool call acts on (a path, a command), or a JSON preview. Already a preview. */
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

/** The recorded tool name, bidi controls escaped. */
export function toolName(event: TraceEvent): string {
  return escapeBidi(asString(event.payload.name) || 'tool')
}

export interface RowText {
  /** Plain text, in the body font. */
  text?: string
  /** A command or a path, in the data font. */
  mono?: string
  /** Muted text (thinking). */
  muted?: boolean
}

/** One-line content of a ledger row. Session text is shown as recorded (bidi controls escaped). */
export function rowText(event: TraceEvent): RowText {
  const payload = event.payload
  switch (event.kind) {
    case 'tool_call':
      return { text: toolName(event), mono: toolTarget(payload.args) }
    case 'tool_result':
      return { text: previewUnknown(payload.output ?? payload.text) }
    case 'request': {
      const model = asString(payload.model) ?? ''
      const stop = asString(payload.stopReason)
      return { text: [escapeBidi(model), stop ? t('common.stop', { reason: escapeBidi(stop) }) : ''].filter(Boolean).join(' · ') }
    }
    case 'thinking':
      return { text: previewText(asString(payload.text) ?? ''), muted: true }
    case 'hook':
      return { text: escapeBidi(asString(payload.name) || asString(payload.event) || asString(payload.type) || 'hook') }
    case 'compaction':
      return { text: previewUnknown(payload.summary) }
    default: {
      const text = asString(payload.text)
      return { text: text ? previewText(text) : previewUnknown(payload.type ?? payload) }
    }
  }
}

/** A row's content as one line: text, then the command or path. */
export function rowLine(event: TraceEvent): string {
  const text = rowText(event)
  return [text.text, text.mono].filter(Boolean).join('  ')
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
