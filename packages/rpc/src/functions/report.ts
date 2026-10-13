import type { ReportLocale, ReportTrace } from '../report.ts'
import { defineRpcFunction } from 'devframe'
import * as z from 'zod/mini'
import { REPORT_LOCALES } from '../report.ts'
import { parseInput } from './parse-input.ts'

export interface ExportReportInput {
  ref: string
  locale?: ReportLocale
}

export interface ExportReportResult {
  /** Where `index.html` was written: an absolute path, with `~` for the home directory. */
  path: string
  /** Events whose original record the report includes, and events in the session. */
  included: number
  total: number
}

let source: (() => Promise<ReportTrace>) | undefined
let exporter: ((input: ExportReportInput) => Promise<ExportReportResult>) | undefined

/** `build` binds the one session it writes; DevFrame bakes the result into the static dump. */
export function bindReportSource(next: () => Promise<ReportTrace>): void {
  source = next
}

/** The dev server binds the writer behind "Export report". */
export function bindReportExporter(next: (input: ExportReportInput) => Promise<ExportReportResult>): void {
  exporter = next
}

/**
 * Argument-free snapshot of the report session: the view trace, the summary, and the first
 * events in full. Registered only in `build` mode, where DevFrame bakes it.
 */
export const reportTrace = defineRpcFunction({
  name: 'report-trace',
  type: 'query',
  jsonSerializable: true,
  snapshot: true,
  setup: () => ({
    handler: async (): Promise<ReportTrace> => {
      if (!source) {
        throw new Error('report-trace is bound only while build writes a report')
      }
      return source()
    },
  }),
})

const NEEDS_REF = 'export-report needs a session ref'
const exportReportInput = z.object(
  { ref: z.string({ error: NEEDS_REF }).check(z.minLength(1, { error: NEEDS_REF })), locale: z.unknown() },
  { error: NEEDS_REF },
)
const reportLocale = z.enum(REPORT_LOCALES)

/** "Export report" in the workspace: the same build as `build <path>`, for the session `ref`. */
export const exportReport = defineRpcFunction({
  name: 'export-report',
  type: 'action',
  jsonSerializable: true,
  setup: () => ({
    handler: async (input: ExportReportInput): Promise<ExportReportResult> => {
      if (!exporter) {
        throw new Error('export-report is available only on the dev server')
      }
      const { ref, locale } = parseInput(exportReportInput, input, Error)
      // Any other locale is ignored, not refused: the report then follows the browser's language.
      return exporter({ ref, locale: z.safeParse(reportLocale, locale).data })
    },
  }),
})
