import type { EventOf, TraceEvent } from '@rivus/agent-trace-schema'
import * as z from 'zod/mini'
import { translate as t } from '@/i18n/locale.ts'
import { escapeBidi, previewText, previewUnknown } from './preview.ts'

/** `payload.$truncated` from `toView`: this event has strings the view shortened (S12). */
export function isShortened(event: TraceEvent | undefined): boolean {
  const paths = event?.payload.$truncated
  return paths !== undefined && paths.length > 0
}

/** Argument keys that name what a tool call acts on, in the order they are tried. */
const TARGET_KEYS = [
  'command',
  'cmd',
  'file_path',
  'filePath',
  'path',
  'pattern',
  'query',
  'url',
  'description',
  'prompt',
]

/** Tool call arguments as the target reads them: one string, or named arguments. */
const toolArgs = z.union([z.string(), z.record(z.string(), z.unknown())])
/** A named argument the target can show: a path or a command, or a command as an argv array. */
const targetArg = z.union([z.string(), z.array(z.string())])

/** The one argument that says what a tool call acts on (a path, a command), or a JSON preview. Already a preview. */
export function toolTarget(args: unknown): string {
  const parsed = z.safeParse(toolArgs, args).data
  // The `typeof` tests below narrow the parsed unions (string or record; string or argv array).
  if (typeof parsed === 'string') {
    return previewText(parsed)
  }
  if (parsed) {
    for (const key of TARGET_KEYS) {
      const value = z.safeParse(targetArg, parsed[key]).data
      if (typeof value === 'string') {
        if (value.trim()) {
          return previewText(value)
        }
      } else if (value) {
        return previewText(value.join(' '))
      }
    }
  }
  return previewUnknown(args)
}

/** The recorded tool name, bidi controls escaped. */
export function toolName(event: EventOf<'tool_call'>): string {
  return escapeBidi(event.payload.name || 'tool')
}

/** The exit code a tool result recorded. */
export function exitCode(result: TraceEvent | undefined): number | undefined {
  return result?.kind === 'tool_result' ? result.payload.exitCode : undefined
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
  switch (event.kind) {
    case 'tool_call':
      return { text: toolName(event), mono: toolTarget(event.payload.args) }
    case 'tool_result':
      return { text: previewUnknown(event.payload.output) }
    case 'request': {
      const { model = '', finishReason: stop } = event.payload
      return {
        text: [escapeBidi(model), stop ? t('common.stop', { reason: escapeBidi(stop) }) : '']
          .filter(Boolean)
          .join(' · '),
      }
    }
    case 'reasoning':
      return { text: previewText(event.payload.text ?? ''), muted: true }
    case 'hook':
      return { text: escapeBidi(event.payload.name || event.payload.event || event.payload.type || 'hook') }
    case 'compaction':
      // `CompactionRow` draws a compaction's label and token counts; its summary is another event.
      return {}
    case 'unknown':
      return { text: previewText(event.payload.type) }
    default: {
      const text = event.payload.text
      return { text: text ? previewText(text) : previewUnknown(event.payload.type ?? event.payload) }
    }
  }
}

/** A row's content as one line: text, then the command or path. */
export function rowLine(event: TraceEvent): string {
  const text = rowText(event)
  return [text.text, text.mono].filter(Boolean).join('  ')
}

/** The text an inspector tab shows for a value: strings as recorded, anything else as indented JSON. */
export function pretty(value: unknown): string {
  if (value == null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, (key, inner: unknown) => (key === '$truncated' ? undefined : inner), 2)
  } catch {
    // JSON.stringify threw (a BigInt or a cycle); String() is the last resort.
    // oxlint-disable-next-line typescript/no-base-to-string
    return String(value)
  }
}
