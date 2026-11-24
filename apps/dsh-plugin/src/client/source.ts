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

const MAX_OPEN_STALE_RETRIES = 3

/**
 * Builds the `WorkspaceSource` for one dsh session over `ctx.connection.rpc`.
 * Every `open()` opens the session anew before requesting the view so retries and stale reloads
 * pick up newly created or rewritten logs; a `trace/view` stale race while the session is actively
 * writing retries `session/open` + `trace/view` up to `MAX_OPEN_STALE_RETRIES` times before
 * surfacing `StaleError`. `event(traceId, id)` forwards the trace id passed in.
 */
export function createEstelaSource(rpc: ClientRpc, sessionId: string): WorkspaceSource {
  return {
    async open() {
      for (let attempt = 0; ; attempt += 1) {
        const opened = unwrapResult(await rpc.call(CHANNEL, 'session/open', { sessionId }))
        const view = await rpc.call(CHANNEL, 'trace/view', { traceId: opened.traceId })
        if (view.ok) {
          return view.value
        }
        if (view.error.code === 'estela/stale' && attempt < MAX_OPEN_STALE_RETRIES) {
          continue
        }
        throw mapChannelFailure(view.error)
      }
    },
    async event(traceId, id) {
      return unwrapResult(await rpc.call(CHANNEL, 'trace/event', { traceId, id }))
    },
  }
}
