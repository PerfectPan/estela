import type { RpcDefinitionsToFunctionsWithNamespace } from 'devframe/rpc'
import { getTrace, reconstructAt } from './functions/get-trace.ts'

export const NAMESPACE = 'agent-trace'

export const serverFunctions = [getTrace, reconstructAt] as const

declare module 'devframe' {
  interface DevframeRpcServerFunctions
    extends RpcDefinitionsToFunctionsWithNamespace<typeof NAMESPACE, typeof serverFunctions> {}
}
