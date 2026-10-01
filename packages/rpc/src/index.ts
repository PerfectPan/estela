import type { RpcDefinitionsToFunctionsWithNamespace } from 'devframe/rpc'
import { listSessions } from './functions/list-sessions.ts'
import { exportReport, reportTrace } from './functions/report.ts'
import { getEvent, getTraceView, loadTrace, reconstructAt } from './functions/trace-view.ts'

export const NAMESPACE = 'agent-trace'

export const serverFunctions = [listSessions, loadTrace, getTraceView, getEvent, reconstructAt, exportReport] as const
/** Registered only when DevFrame builds a static report: the one argument-free snapshot it bakes. */
export const reportFunctions = [reportTrace] as const

export {
  bindReportExporter,
  bindReportSource,
  type ExportReportInput,
  type ExportReportResult,
} from './functions/report.ts'
export { bindSessionService, type SessionService } from './functions/service.ts'
export { bindTraceStore, CURRENT_REF, LOAD_PROGRESS_CHANNEL, SUBSCRIBE_GRACE_MS, type LoadTraceResult } from './functions/trace-view.ts'
export {
  emptySessionsSignal,
  SESSIONS_STATE,
  type HostListEntry,
  type ListSessionsQuery,
  type ListSessionsResult,
  type SessionError,
  type SessionListRow,
  type SessionsSignal,
} from './list-types.ts'
export { bindSessionPublisher, emitSessions } from './publish.ts'
export { buildReport, type ReportLocale, type ReportTrace } from './report.ts'
export {
  LoadCancelledError,
  TraceStore,
  type EventDetail,
  type LoadedTrace,
  type LoadHandle,
  type LoadOpts,
  type LoadProgress,
  type ResolvedSession,
  type TraceStoreDeps,
  type TraceViewResult,
} from './trace-store.ts'

declare module 'devframe' {
  interface DevframeRpcServerFunctions
    extends RpcDefinitionsToFunctionsWithNamespace<typeof NAMESPACE, readonly [...typeof serverFunctions, ...typeof reportFunctions]> {}
}
