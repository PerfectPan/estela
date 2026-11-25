import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { Trace } from '@rivus/estela-schema'
import type { EventDetail, TraceRedaction, TraceStore } from './trace-store.ts'
import { VIEW_BYTES } from './trace-store-types.ts'
import { fitView, fold, summaryOf } from '@rivus/estela-kernel'
import { withoutOriginals } from './original-reload.ts'
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
  /**
   * The session as loaded, every string whole. The report builds its own view from it, so an id is given its
   * alias before anything is cut short; originals are ignored.
   */
  trace: Trace
  /** Full events (with `original`) for ids as recorded, in the same order; not shown. */
  full: (ids: readonly string[]) => Promise<EventDetail[]>
  /** Always applied, whatever the server does: the report is redacted, and its ids are shown with it. */
  redact: TraceRedaction
  locale?: ReportLocale
  maxEvents?: number
  maxBytes?: number
  /** The view's starting string cap, and where a view over budget is reported; as the store was given them. */
  maxString?: number
  log?: (line: string) => void
}

const encoder = new TextEncoder()

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

/** Builds the report payload: the redacted view trace plus the first events in full, within the limits. */
export async function buildReport(input: ReportInput): Promise<ReportTrace> {
  const maxEvents = input.maxEvents ?? REPORT_MAX_EVENTS
  const maxBytes = input.maxBytes ?? REPORT_MAX_BYTES
  // The report's own aliases, from the whole trace: a reference the view cuts short still meets its event, and
  // two ids that redact to the same text still name different events, whether or not the server redacted a view.
  const ids = new TraceIds(input.trace, id => input.redact.text(id) === id)
  const shown = input.redact.value(ids.shown(withoutOriginals(input.trace)))
  const view = fitView(shown, { maxString: input.maxString, maxBytes: VIEW_BYTES })
  if (view.trace.view?.withinBudget === false) {
    input.log?.(`a report view is ${view.bytes} bytes at the 256-character floor, over the ${VIEW_BYTES}-byte budget`)
  }
  const trace = view.trace
  // Asked for as recorded: an alias is the report's own, which the reader does not know.
  const asked = trace.events.map(event => ids.findEvent(event.id) ?? event.id)
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
    summary: input.redact.value(summaryOf(fold(input.trace))),
    events,
    total: asked.length,
    truncated: events.length < asked.length,
    locale: input.locale,
  }
}

/** What a report is given besides the session: its redaction, and the limits a test may lower. */
export type ReportSettings = Pick<ReportInput, 'redact'>
  & Partial<Pick<ReportInput, 'locale' | 'maxEvents' | 'maxBytes'>>

/** The report of the session `traceId` as the store has it loaded: its view and its full events from one snapshot. */
export async function loadedReport(store: TraceStore, traceId: string, input: ReportSettings): Promise<ReportTrace> {
  return store.withEvents(traceId, loaded =>
    buildReport({ ...loaded, ...input, trace: loaded.trace, full: loaded.read }),
  )
}
