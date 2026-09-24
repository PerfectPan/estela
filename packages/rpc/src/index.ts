import type { RpcDefinitionsToFunctionsWithNamespace } from 'devframe/rpc'
import { getTrace, reconstructAt } from './functions/get-trace.ts'
import { listSessions } from './functions/list-sessions.ts'
import { sessionTrace } from './functions/session-trace.ts'

export const NAMESPACE = 'agent-trace'

export const serverFunctions = [getTrace, reconstructAt, listSessions, sessionTrace] as const

export { type TraceView } from './functions/get-trace.ts'
export { bindSessionService, type SessionService, type SessionView } from './functions/service.ts'
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

declare module 'devframe' {
  interface DevframeRpcServerFunctions
    extends RpcDefinitionsToFunctionsWithNamespace<typeof NAMESPACE, typeof serverFunctions> {}
}
