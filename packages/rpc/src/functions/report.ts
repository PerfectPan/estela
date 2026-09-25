import type { ReportLocale, ReportTrace } from '../report.ts'
import { defineRpcFunction } from 'devframe'

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
  truncated: boolean
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
      if (!source)
        throw new Error('report-trace is bound only while build writes a report')
      return source()
    },
  }),
})

function checkInput(input: unknown): ExportReportInput {
  const value = (input ?? {}) as Record<string, unknown>
  if (typeof value.ref !== 'string' || value.ref.length === 0)
    throw new Error('export-report needs a session ref')
  const locale = value.locale === 'en' || value.locale === 'zh-CN' ? value.locale : undefined
  return { ref: value.ref, locale }
}

/** "Export report" in the workspace: the same build as `build <path>`, for the session `ref`. */
export const exportReport = defineRpcFunction({
  name: 'export-report',
  type: 'action',
  jsonSerializable: true,
  setup: () => ({
    handler: async (input: ExportReportInput): Promise<ExportReportResult> => {
      if (!exporter)
        throw new Error('export-report is available only on the dev server')
      return exporter(checkInput(input))
    },
  }),
})
