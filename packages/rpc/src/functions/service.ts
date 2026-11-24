import type { ListSessionsQuery, ListSessionsResult } from '../list-types.ts'
import type { TraceStore } from '../trace-store.ts'
import type { ExportReportInput, ExportReportResult, ReportSource } from './report.ts'

/** Services one Estela server instance supplies to its RPC handlers. */
export interface ServerServices {
  store: TraceStore
  listSessions?: (input: ListSessionsQuery) => Promise<ListSessionsResult>
  exportReport?: (input: ExportReportInput) => Promise<ExportReportResult>
  /** The one report a build bakes; `writeReport` sets it right before DevFrame builds. */
  reportSource: ReportSource
}
