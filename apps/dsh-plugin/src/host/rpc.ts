import * as z from 'zod/mini'
import type { ChannelErrorCode } from '../contract/channel.ts'

interface RpcFailure {
  readonly code: ChannelErrorCode
  readonly message: string
  readonly details: Record<string, never>
}

export type RpcHandlerResult<T = unknown> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcFailure }

export interface HostPeer {
  readonly principal?: { readonly kind?: unknown } | undefined
}

export type RpcHandler = (
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
  peer: HostPeer | undefined,
) => Promise<RpcHandlerResult>

export interface HostConnectionRpc {
  handle: (channel: string, handler: RpcHandler) => (() => void | Promise<void>) | void
}

export interface HostConnection {
  readonly rpc: HostConnectionRpc
}

/** @internal */
export interface HostSessionSnapshot {
  readonly location?: {
    readonly kind?: string
    readonly path?: string
  }
}

export interface HostSessionPersistence {
  stat: (sessionId: string, options?: { readonly signal?: AbortSignal }) => Promise<HostSessionSnapshot | undefined>
}

/** @internal */
export type EffectDisposer = () => void | Promise<void>

export interface HostContext {
  readonly connection: HostConnection
  readonly sessionPersistence: HostSessionPersistence
  readonly effect: (callback: () => EffectDisposer | void, label?: string) => unknown
}

const connectionRpcSchema = z.object({
  handle: z.custom<HostConnectionRpc['handle']>(value => typeof value === 'function'),
})

/**
 * Reads `rpc` from `ctx.connection` through its prototype getter first so dsh 0.2.2-rc.5 binds
 * the channel route in the plugin's own `webServer` scope; falls back to the plain property if a
 * later dsh exposes `rpc` directly.
 */
export function resolveConnectionRpc(connection: HostConnection): HostConnectionRpc {
  const proto: unknown = Object.getPrototypeOf(connection)
  const descriptor = proto !== null ? Object.getOwnPropertyDescriptor(proto, 'rpc') : undefined
  const candidate: unknown = descriptor?.get?.call(connection) ?? connection.rpc
  const parsed = z.parse(connectionRpcSchema, candidate)
  return {
    handle: (channel, handler) => parsed.handle.call(candidate, channel, handler),
  }
}
