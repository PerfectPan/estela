import type { RpcDefinitionsToFunctionsWithNamespace } from 'devframe/rpc'
import { getTrace, reconstructAt } from './functions/get-trace.ts'

export const NAMESPACE = 'agent-trace'

export const serverFunctions = [getTrace, reconstructAt] as const

export { bindSessionService, type SessionService, type TraceView } from './functions/get-trace.ts'

declare module 'devframe' {
  interface DevframeRpcServerFunctions
    extends RpcDefinitionsToFunctionsWithNamespace<typeof NAMESPACE, typeof serverFunctions> {}
}
