import type { EventDetail } from '@rivus/estela-rpc'
import type { ContextTokens, ReconstructResult, Trace, TruncatedPath } from '@rivus/estela-schema'
import { capStrings, mainAgentId } from '@rivus/estela-kernel'
import {
  FIELD_CHARS,
  iso,
  jsonChars,
  PATH_CHARS,
  PROMPT_CHARS,
  put,
  RESULT_CHARS,
  shown,
  SURFACE_IDS,
  type Redaction,
} from './bounds.ts'
import type { TraceIds } from './trace-ids.ts'

/** The view's floor: below this a string says too little to be worth returning. */
const MIN_CHARS = 256
const STEP = 0.75
export const DEFAULT_MAX_CHARS = 2000

interface ShownEvent {
  id: string
  seq: number
  ts: string
  kind: string
  lane: string
  parentId?: string
  requestId?: string
  /** The compaction that removed this event from the model's context. */
  shadowedBy?: string
  /** The log file (with `~` for the home directory) and line the event was read from. */
  source: { file: string; line: number }
  payload: unknown
  /** The parsed log record, with `original: true`. */
  original?: unknown
  /** Why the record could not be read back, with `original: true`. */
  originalUnavailable?: string
  /** Strings and keys cut to `maxChars`, as paths from this object. */
  truncated?: TruncatedPath[]
  /** Parts left out because even at 256 characters per string they would take the result past its size bound. */
  omitted?: ('original' | 'payload')[]
}

export interface EventResult {
  traceId: string
  /** The longest string returned whole: the `maxChars` asked for, or lower when the event did not fit at it. */
  maxChars: number
  event: ShownEvent
}

/**
 * One event, every string cut to `maxChars` and the result kept under its size bound: the cap is lowered in steps of
 * 0.75 down to 256, then the original record (when asked for) and then the payload are left out. Everything is
 * redacted before anything is cut, so a cut never leaves part of a home path or token behind.
 */
export function eventResult(
  trace: Trace,
  traceId: string,
  detail: EventDetail,
  ids: TraceIds,
  options: { maxChars: number; original: boolean },
  redaction: Redaction,
): EventResult {
  const { $truncated: _view, ...payload }: Record<string, unknown> = detail.payload
  const fields: Omit<ShownEvent, 'payload' | 'original' | 'truncated'> = {
    id: ids.event(detail.id),
    seq: detail.seq,
    ts: iso(detail.ts),
    kind: detail.kind,
    lane: ids.lane(detail.agentId ?? mainAgentId(trace)),
    source: { file: shown(detail.source.file, PATH_CHARS, redaction).text, line: detail.source.line },
  }
  put(fields, 'parentId', detail.parentId === undefined ? undefined : ids.event(detail.parentId))
  put(
    fields,
    'requestId',
    detail.requestId === undefined ? undefined : shown(detail.requestId, FIELD_CHARS, redaction).text,
  )
  put(fields, 'shadowedBy', detail.shadowedBy === undefined ? undefined : ids.event(detail.shadowedBy))
  if (options.original && detail.originalUnavailable !== undefined) {
    fields.originalUnavailable = shown(detail.originalUnavailable, PROMPT_CHARS, redaction).text
  }
  const parts = redaction.value({ fields, payload, original: options.original ? detail.original : undefined })

  const build = (max: number, omitted: ('original' | 'payload')[]): EventResult => {
    const truncated: TruncatedPath[] = []
    const capped = (part: 'payload' | 'original', value: unknown): unknown => {
      const out = capStrings(value, max)
      truncated.push(...out.truncated.map(path => [part, ...path]))
      return out.value
    }
    const event: ShownEvent = {
      ...parts.fields,
      payload: omitted.includes('payload') ? {} : capped('payload', parts.payload),
    }
    if (parts.original !== undefined && !omitted.includes('original')) {
      event.original = capped('original', parts.original)
    }
    if (truncated.length > 0) {
      event.truncated = truncated
    }
    if (omitted.length > 0) {
      event.omitted = omitted
    }
    return { traceId, maxChars: max, event }
  }

  let max = options.maxChars
  let result = build(max, [])
  while (jsonChars(result) > RESULT_CHARS && max > MIN_CHARS) {
    max = Math.max(MIN_CHARS, Math.floor(max * STEP))
    result = build(max, [])
  }
  // Only parts the result holds are left out: `original` when it was asked for, then the payload.
  const steps: ('original' | 'payload')[][] =
    parts.original === undefined ? [['payload']] : [['original'], ['original', 'payload']]
  for (const omitted of steps) {
    if (jsonChars(result) <= RESULT_CHARS) {
      break
    }
    result = build(max, omitted)
  }
  return result
}

interface SurfaceSlot {
  name: string
  status: string
  /** The last `SURFACE_IDS` (or fewer) event ids in this slot. */
  eventIds: string[]
  eventCount: number
  recordedBy?: string
}

export interface SurfaceResult {
  traceId: string
  eventId: string
  completeness: ReconstructResult['completeness']
  unavailable: string[]
  slots: SurfaceSlot[]
  tokens: ContextTokens[]
  /** The last ids on the model-visible surface, nearest the event; `visibleCount` counts them all. */
  visibleIds: string[]
  visibleCount: number
  /** The last ids a compaction before the event removed. */
  removedIds: string[]
  removedCount: number
  /** Id lists cut to their last entries, as paths. */
  truncated?: (string | number)[][]
}

/**
 * A reconstruction with every id shown as the tools show it and each id list cut to its last entries (100, halved
 * until the result fits its size bound). The counts say how many there are in all.
 */
export function surfaceResult(
  traceId: string,
  surface: ReconstructResult,
  ids: TraceIds,
  redaction: Redaction,
): SurfaceResult {
  const build = (keep: number): SurfaceResult => {
    const truncated: (string | number)[][] = []
    const last = (list: readonly string[], path: (string | number)[]): string[] => {
      if (list.length > keep) {
        truncated.push(path)
      }
      return ids.events(list.slice(Math.max(0, list.length - keep)))
    }
    const removed = surface.removedIds ?? []
    const out: SurfaceResult = {
      traceId,
      eventId: ids.event(surface.eventId),
      completeness: surface.completeness,
      unavailable: surface.unavailable,
      slots: (surface.slots ?? []).map((slot, index) => {
        const item: SurfaceSlot = {
          name: slot.name,
          status: slot.status,
          eventIds: last(slot.eventIds, ['slots', index, 'eventIds']),
          eventCount: slot.eventIds.length,
        }
        put(item, 'recordedBy', slot.recordedBy === undefined ? undefined : ids.event(slot.recordedBy))
        return item
      }),
      tokens: surface.tokens ?? [],
      visibleIds: last(surface.visibleIds, ['visibleIds']),
      visibleCount: surface.visibleIds.length,
      removedIds: last(removed, ['removedIds']),
      removedCount: removed.length,
    }
    if (truncated.length > 0) {
      out.truncated = truncated
    }
    return redaction.value(out)
  }
  let keep = SURFACE_IDS
  let result = build(keep)
  while (jsonChars(result) > RESULT_CHARS && keep > 1) {
    keep = Math.floor(keep / 2)
    result = build(keep)
  }
  return result
}
