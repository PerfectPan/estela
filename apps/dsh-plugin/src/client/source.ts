import { NoLogError, StaleError, type WorkspaceSource } from '@rivus/estela-web/embed'
import { CHANNEL } from '../contract/channel.ts'
import type { ClientRpc, ClientRpcFailure, ClientRpcResult } from './types.ts'

/** @internal Maps a `/estela` channel refusal to the error class `<estela-workspace>` expects. */
export function mapChannelFailure(failure: ClientRpcFailure): Error {
  const message = failure.message.length > 0 ? failure.message : failure.code
  if (failure.code === 'estela/no-log') {
    return new NoLogError(message)
  }
  if (failure.code === 'estela/stale') {
    return new StaleError(message)
  }
  return new Error(message)
}

function unwrapResult<T>(result: ClientRpcResult<T>): T {
  if (!result.ok) {
    throw mapChannelFailure(result.error)
  }
  return result.value
}

/**
 * Builds the `WorkspaceSource` for one dsh session over `ctx.connection.rpc`.
 * Every `open()` opens the session anew before requesting the view so retries and stale reloads
 * pick up newly created or rewritten logs; `event(traceId, id)` forwards the trace id passed in.
 */
export function createEstelaSource(rpc: ClientRpc, sessionId: string): WorkspaceSource {
  return {
    async open() {
      const opened = unwrapResult(await rpc.call(CHANNEL, 'session/open', { sessionId }))
      return unwrapResult(await rpc.call(CHANNEL, 'trace/view', { traceId: opened.traceId }))
    },
    async event(traceId, id) {
      return unwrapResult(await rpc.call(CHANNEL, 'trace/event', { traceId, id }))
    },
  }
}
