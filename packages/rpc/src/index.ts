import type { RpcDefinitionsToFunctionsWithNamespace } from 'devframe/rpc'
import { getTrace } from './functions/get-trace.ts'
import { listSessions } from './functions/list-sessions.ts'
import { getEvent, getTraceView, loadTrace, reconstructAt } from './functions/trace-view.ts'

export const NAMESPACE = 'agent-trace'

export const serverFunctions = [getTrace, listSessions, loadTrace, getTraceView, getEvent, reconstructAt] as const

export { type TraceView } from './functions/get-trace.ts'
export { bindSessionService, type SessionService, type SessionView } from './functions/service.ts'
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
    extends RpcDefinitionsToFunctionsWithNamespace<typeof NAMESPACE, typeof serverFunctions> {}
}
