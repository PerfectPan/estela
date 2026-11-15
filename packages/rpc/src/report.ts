import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { Trace } from '@rivus/estela-schema'
import type { EventDetail, TraceViewResult } from './trace-store.ts'

/** A report holds the originals of at most the first 2,000 events or 20 MB, whichever is smaller. */
const REPORT_MAX_EVENTS = 2000
const REPORT_MAX_BYTES = 20 * 1000 * 1000

/** Events asked for per call while filling the report (bounds memory before the byte check). */
const BATCH = 250

export const REPORT_LOCALES = ['en', 'zh-CN'] as const
export type ReportLocale = (typeof REPORT_LOCALES)[number]

/** `report-trace`: everything the SPA's report mode needs, redacted. */
export interface ReportTrace {
  /** The view trace (`fitView`), as `get-trace-view` returns it. */
  trace: Trace
  summary: SessionSummary
  /** Full events with their original records, in event order: the first `events.length` of `total`. */
  events: EventDetail[]
  /** Events in the session. */
  total: number
  /** `events.length < total`: the report header says so, and later events show "original not included". */
  truncated: boolean
  /** The UI locale at export time; absent for `build`, where the browser's language decides. */
  locale?: ReportLocale
}

export interface ReportInput {
  view: TraceViewResult
  /** Full events (with `original`) for these ids, in the same order. */
  full: (ids: readonly string[]) => Promise<EventDetail[]>
  /** Always applied: the report is redacted whatever the server does. */
  redact: <T>(value: T) => T
  locale?: ReportLocale
  maxEvents?: number
  maxBytes?: number
}

const encoder = new TextEncoder()

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

/** Builds the report payload: the redacted view trace plus the first events in full, within the limits. */
export async function buildReport(input: ReportInput): Promise<ReportTrace> {
  const maxEvents = input.maxEvents ?? REPORT_MAX_EVENTS
  const maxBytes = input.maxBytes ?? REPORT_MAX_BYTES
  const trace = input.redact(input.view.trace)
  const ids = trace.events.map(event => event.id)
  const events: EventDetail[] = []
  let eventBytes = 0
  let full = false
  for (let start = 0; start < ids.length && !full && events.length < maxEvents; start += BATCH) {
    const batch = await input.full(ids.slice(start, Math.min(start + BATCH, maxEvents)))
    for (const event of batch) {
      const redacted = input.redact(event)
      // The comma between array items counts too.
      const bytes = jsonBytes(redacted) + (events.length > 0 ? 1 : 0)
      if (eventBytes + bytes > maxBytes) {
        full = true
        break
      }
      events.push(redacted)
      eventBytes += bytes
    }
  }
  return {
    trace,
    summary: input.redact(input.view.summary),
    events,
    total: ids.length,
    truncated: events.length < ids.length,
    locale: input.locale,
  }
}
