import type { LoadHandle } from '@rivus/estela-rpc/trace-store'
import type { EstelaCore } from '@rivus/estela-server/core'
import * as z from 'zod/mini'
import { channelInputs, type ChannelErrorCode, type ChannelResult } from '../contract/channel.ts'
import type { HostPeer, RpcFailureResult, RpcHandler, RpcHandlerResult } from './rpc.ts'
import { FIXED_FAILURE_MESSAGE, STALE_MESSAGE, type IssuedSession, type SessionRegistry } from './sessions.ts'

interface ChannelHostDeps {
  readonly core: EstelaCore
  readonly sessions: SessionRegistry
}

export interface ChannelHost {
  readonly handler: RpcHandler
  readonly dispose: () => void
  /** Number of currently open TraceStore load holds; exposed for lifecycle tests. */
  readonly activeHoldCount: () => number
}

const snapshotChangedErrorSchema = z.object({ name: z.literal('SnapshotChangedError') })
const loadCancelledErrorSchema = z.object({ name: z.literal('LoadCancelledError') })

function refusal(code: ChannelErrorCode, message: string): RpcFailureResult {
  return { ok: false, error: { code, message, details: {} } }
}

function closedRefusal(): RpcFailureResult {
  return refusal('estela/closed', 'the plugin is closed')
}

function isOwnerPeer(peer: HostPeer | undefined): boolean {
  return peer?.principal?.kind === 'owner'
}

/** Reads `signal.aborted` without TypeScript narrowing a pre-await `false` across `await`. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Creates the `/estela` RPC channel handler and its disposer.
 * Never throws into dsh: every refusal and unexpected exception maps to `{ ok: false, error }`
 * with `details: {}`.
 */
export function createChannelHost(deps: ChannelHostDeps): ChannelHost {
  let disposed = false
  const disposeController = new AbortController()
  const activeHolds = new Set<() => void>()

  /** Reads `disposed` without TypeScript narrowing a pre-await `false` across `await`. */
  function isDisposed(): boolean {
    return disposed
  }

  function storeFailure(error: unknown, traceId: string, signal?: AbortSignal): RpcFailureResult {
    if (isDisposed()) {
      return closedRefusal()
    }
    if (z.safeParse(snapshotChangedErrorSchema, error).success) {
      deps.sessions.invalidate(traceId)
      return refusal('estela/stale', STALE_MESSAGE)
    }
    if ((signal && isAborted(signal)) || z.safeParse(loadCancelledErrorSchema, error).success) {
      return refusal('estela/failed', FIXED_FAILURE_MESSAGE)
    }
    if (error instanceof Error && error.message.length > 0) {
      return refusal('estela/failed', deps.core.redact(error.message))
    }
    return refusal('estela/failed', FIXED_FAILURE_MESSAGE)
  }

  async function handleOpen(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<RpcHandlerResult<ChannelResult<'session/open'>>> {
    const callSignal = AbortSignal.any([signal, disposeController.signal])
    const opened = await deps.sessions.open(sessionId, callSignal)
    if (isDisposed()) {
      return closedRefusal()
    }
    return opened.ok ? { ok: true, value: { traceId: opened.traceId } } : opened.result
  }

  async function withReadySession<T>(
    traceId: string,
    run: (session: IssuedSession) => Promise<RpcHandlerResult<T>>,
  ): Promise<RpcHandlerResult<T>> {
    const ready = await deps.sessions.checkReady(traceId)
    if (!ready.ok) {
      return isDisposed() ? closedRefusal() : ready.result
    }
    if (isDisposed()) {
      return closedRefusal()
    }
    const unpin = deps.sessions.pin(traceId, ready.session)
    try {
      return await run(ready.session)
    } finally {
      unpin()
    }
  }

  async function handleTraceView(
    traceId: string,
    signal: AbortSignal,
  ): Promise<RpcHandlerResult<ChannelResult<'trace/view'>>> {
    return withReadySession(traceId, async () => {
      if (isAborted(signal)) {
        return refusal('estela/failed', FIXED_FAILURE_MESSAGE)
      }

      let releaseHold: (() => void) | undefined
      const onAbort = (): void => {
        releaseHold?.()
      }
      signal.addEventListener('abort', onAbort, { once: true })

      try {
        const handle: LoadHandle = await deps.core.store.open(traceId)
        let released = false
        const release = (): void => {
          if (released) {
            return
          }
          released = true
          activeHolds.delete(release)
          handle.release()
        }
        releaseHold = release
        activeHolds.add(release)

        if (isDisposed()) {
          release()
          return closedRefusal()
        }
        if (isAborted(signal)) {
          release()
          return refusal('estela/failed', FIXED_FAILURE_MESSAGE)
        }

        await handle.done
        if (isDisposed()) {
          return closedRefusal()
        }
        if (isAborted(signal)) {
          return refusal('estela/failed', FIXED_FAILURE_MESSAGE)
        }
        const view = await deps.core.store.view(traceId)
        if (isDisposed()) {
          return closedRefusal()
        }
        if (isAborted(signal)) {
          return refusal('estela/failed', FIXED_FAILURE_MESSAGE)
        }
        return { ok: true, value: view }
      } catch (error) {
        return storeFailure(error, traceId, signal)
      } finally {
        signal.removeEventListener('abort', onAbort)
        releaseHold?.()
      }
    })
  }

  async function handleTraceEvent(
    traceId: string,
    id: string,
  ): Promise<RpcHandlerResult<ChannelResult<'trace/event'>>> {
    return withReadySession(traceId, async session => {
      try {
        const event = await deps.core.store.event(traceId, id)
        if (isDisposed()) {
          return closedRefusal()
        }
        if (event.originalUnavailable !== undefined) {
          const stale = await deps.sessions.checkUnavailableEvent(traceId, session)
          if (stale) {
            return isDisposed() ? closedRefusal() : stale
          }
        }
        return { ok: true, value: event }
      } catch (error) {
        return storeFailure(error, traceId)
      }
    })
  }

  async function dispatch(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
    peer: HostPeer | undefined,
  ): Promise<RpcHandlerResult> {
    if (isDisposed()) {
      return closedRefusal()
    }
    if (!isOwnerPeer(peer)) {
      return refusal('estela/forbidden', 'only the owner may read sessions')
    }

    switch (endpoint) {
      case 'session/open': {
        const parsed = z.safeParse(channelInputs['session/open'], payload)
        if (!parsed.success) {
          return refusal('estela/bad-request', 'invalid request payload')
        }
        return handleOpen(parsed.data.sessionId, signal)
      }
      case 'trace/view': {
        const parsed = z.safeParse(channelInputs['trace/view'], payload)
        if (!parsed.success) {
          return refusal('estela/bad-request', 'invalid request payload')
        }
        return handleTraceView(parsed.data.traceId, signal)
      }
      case 'trace/event': {
        const parsed = z.safeParse(channelInputs['trace/event'], payload)
        if (!parsed.success) {
          return refusal('estela/bad-request', 'invalid request payload')
        }
        return handleTraceEvent(parsed.data.traceId, parsed.data.id)
      }
      default:
        return refusal('estela/bad-request', 'unknown endpoint')
    }
  }

  const handler: RpcHandler = async (endpoint, payload, signal, peer) => {
    let onDispose: (() => void) | undefined
    const disposedPromise = new Promise<RpcHandlerResult>(resolve => {
      if (disposeController.signal.aborted) {
        resolve(closedRefusal())
        return
      }
      onDispose = () => resolve(closedRefusal())
      disposeController.signal.addEventListener('abort', onDispose, { once: true })
    })

    const work = (async (): Promise<RpcHandlerResult> => {
      try {
        return await dispatch(endpoint, payload, signal, peer)
      } catch {
        return isDisposed() ? closedRefusal() : refusal('estela/failed', FIXED_FAILURE_MESSAGE)
      }
    })()
    work.catch(() => {})

    try {
      return await Promise.race([work, disposedPromise])
    } finally {
      if (onDispose) {
        disposeController.signal.removeEventListener('abort', onDispose)
      }
    }
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    disposed = true
    deps.sessions.close()
    for (const release of activeHolds) {
      release()
    }
    activeHolds.clear()
    disposeController.abort()
  }

  return {
    handler,
    dispose,
    activeHoldCount: () => activeHolds.size,
  }
}
