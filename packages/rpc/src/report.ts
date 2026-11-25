import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { Trace } from '@rivus/estela-schema'
import type { EventDetail, TraceRedaction, TraceViewResult } from './trace-store.ts'
import { TraceIds } from './trace-ids.ts'

/** A report holds the originals of at most the first 2,000 events or 20 MB, whichever is smaller. */
const REPORT_MAX_EVENTS = 2000
const REPORT_MAX_BYTES = 20 * 1000 * 1000

/** Events asked for per call while filling the report (bounds memory before the byte check). */
const BATCH = 250

export const REPORT_LOCALES = ['en', 'zh-CN'] as const
export type ReportLocale = (typeof REPORT_LOCALES)[number]

/** `report-trace`: everything the SPA's report mode needs, redacted. */
export interface ReportTrace {
  /** The view trace (`fitView`), redacted, its ids shown by the report's own redaction. */
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
  /**
   * Full events (with `original`) for ids as the view shows them, in the same order. Each comes as `get-event`
   * shows it, or as recorded where nothing redacts: the report shows and redacts what is still recorded.
   */
  full: (ids: readonly string[]) => Promise<EventDetail[]>
  /** Always applied, whatever the server does: the report is redacted, and its ids are shown with it. */
  redact: TraceRedaction
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
  // The report's own aliases, whether or not the server redacted the view: the report is redacted always, and
  // two ids that redact to the same text must still name different events in it.
  const ids = new TraceIds(input.view.trace, id => input.redact.text(id) === id)
  const trace = input.redact.value(ids.shown(input.view.trace))
  // Asked by the view's own ids, not the shown ones: they name events in the store, which may not redact.
  const asked = input.view.trace.events.map(event => event.id)
  const events: EventDetail[] = []
  let eventBytes = 0
  let full = false
  for (let start = 0; start < asked.length && !full && events.length < maxEvents; start += BATCH) {
    const batch = await input.full(asked.slice(start, Math.min(start + BATCH, maxEvents)))
    for (const event of batch) {
      const redacted = input.redact.value(ids.eventShown(event))
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
    summary: input.redact.value(input.view.summary),
    events,
    total: asked.length,
    truncated: events.length < asked.length,
    locale: input.locale,
  }
}
