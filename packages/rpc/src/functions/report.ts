import type { ReportLocale, ReportTrace } from '../report.ts'
import { defineRpcFunction } from 'devframe'
import * as z from 'zod/mini'
import { REPORT_LOCALES } from '../report.ts'
import { parseInput } from './parse-input.ts'

export interface ExportReportInput {
  traceId: string
  locale?: ReportLocale
}

export interface ExportReportResult {
  /** Where `index.html` was written: an absolute path, with `~` for the home directory. */
  path: string
  /** Events whose original record the report includes, and events in the session. */
  included: number
  total: number
}

/** Per-instance slot for the one report `build` or "Export report" bakes into `report-trace`. */
export interface ReportSource {
  set: (next: () => Promise<ReportTrace>) => void
  read: () => Promise<ReportTrace>
}

export function createReportSource(): ReportSource {
  let current: (() => Promise<ReportTrace>) | undefined
  return {
    set(next) {
      current = next
    },
    async read() {
      if (!current) {
        throw new Error('report-trace is bound only while build writes a report')
      }
      return current()
    },
  }
}

/**
 * Argument-free snapshot of the report session: the view trace, the summary, and the first
 * events in full. Registered only in `build` mode, where DevFrame bakes it.
 */
export function createReportTrace(reportSource: ReportSource) {
  return defineRpcFunction({
    name: 'report-trace',
    type: 'query',
    jsonSerializable: true,
    snapshot: true,
    setup: () => ({
      handler: async (): Promise<ReportTrace> => reportSource.read(),
    }),
  })
}

const NEEDS_TRACE_ID = 'export-report needs a trace id'
const exportReportInput = z.object(
  {
    traceId: z.string({ error: NEEDS_TRACE_ID }).check(z.minLength(1, { error: NEEDS_TRACE_ID })),
    locale: z.unknown(),
  },
  { error: NEEDS_TRACE_ID },
)
const reportLocale = z.enum(REPORT_LOCALES)

/** "Export report" in the workspace: the same build as `build <path>`, for the session `traceId`. */
export function createExportReport(exporter?: (input: ExportReportInput) => Promise<ExportReportResult>) {
  return defineRpcFunction({
    name: 'export-report',
    type: 'action',
    jsonSerializable: true,
    setup: () => ({
      handler: async (input: ExportReportInput): Promise<ExportReportResult> => {
        if (!exporter) {
          throw new Error('export-report is available only on the dev server')
        }
        const { traceId, locale } = parseInput(exportReportInput, input, Error)
        // Any other locale is ignored, not refused: the report then follows the browser's language.
        return exporter({ traceId, locale: z.safeParse(reportLocale, locale).data })
      },
    }),
  })
}
