import type { RpcDefinitionsToFunctionsWithNamespace } from 'devframe/rpc'
import type { ServerServices } from './functions/service.ts'
import { createListSessions } from './functions/list-sessions.ts'
import { createExportReport, createReportTrace } from './functions/report.ts'
import { createTraceFunctions } from './functions/trace-view.ts'

export const NAMESPACE = 'estela'

export function createServerFunctions(services: ServerServices) {
  const { loadTrace, getTraceView, getEvent, reconstructAt } = createTraceFunctions(services.store)
  return [
    createListSessions(services),
    loadTrace,
    getTraceView,
    getEvent,
    reconstructAt,
    createExportReport(services.exportReport),
  ] as const
}

/** Registered only when DevFrame builds a static report: the one argument-free snapshot it bakes. */
export function createReportFunctions(services: Pick<ServerServices, 'reportSource'>) {
  return [createReportTrace(services.reportSource)] as const
}

export type ServerFunctions = ReturnType<typeof createServerFunctions>
export type ReportFunctions = ReturnType<typeof createReportFunctions>

export {
  createReportSource,
  type ExportReportInput,
  type ExportReportResult,
  type ReportSource,
} from './functions/report.ts'
export type { ServerServices } from './functions/service.ts'
export { LOAD_PROGRESS_CHANNEL, SUBSCRIBE_GRACE_MS, type LoadTraceResult } from './functions/trace-view.ts'
export {
  emptySessionsSignal,
  SESSIONS_STATE,
  type AgentListEntry,
  type ListSessionsQuery,
  type ListSessionsResult,
  type SessionError,
  type SessionListRow,
  type SessionsSignal,
} from './list-types.ts'
export { createSessionPublisher, type SessionPublisher } from './publish.ts'
export { buildReport, type ReportLocale, type ReportTrace } from './report.ts'
export {
  CURRENT_TRACE_ID,
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
  interface DevframeRpcServerFunctions extends RpcDefinitionsToFunctionsWithNamespace<
    typeof NAMESPACE,
    readonly [...ServerFunctions, ...ReportFunctions]
  > {}
}
