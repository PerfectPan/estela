import process from 'node:process'
import { createEstelaCore, type EstelaCoreOptions } from '@rivus/estela-server/core'
import { CHANNEL } from '../contract/channel.ts'
import { createChannelHost } from './channel.ts'
import { resolveConnectionRpc, type HostContext } from './rpc.ts'
import { createSessionRegistry } from './sessions.ts'

export const name = '@rivus/dsh-estela'
export const inject = ['connection', 'webServer', 'sessionPersistence'] as const

/** @internal */
export interface MountHostOptions {
  readonly platform?: EstelaCoreOptions['platform']
}

/**
 * Mounts the `/estela` channel inside `ctx.effect` and binds its disposer to release every open
 * load hold and clear all issued trace ids.
 * @internal
 */
export function mountHost(ctx: HostContext, options: MountHostOptions = {}): void {
  const redacts = (options.platform?.env ?? process.env).ESTELA_REDACT !== '0'
  let resolveTrace: EstelaCoreOptions['resolve'] = () => undefined
  const core = createEstelaCore({
    ...(options.platform ? { platform: options.platform } : {}),
    redacts,
    resolve: traceId => resolveTrace?.(traceId),
  })
  const sessions = createSessionRegistry({
    persistence: ctx.sessionPersistence,
    fs: core.platform.fs,
    store: core.store,
    redact: core.redact,
  })
  resolveTrace = traceId => sessions.resolve(traceId)
  const channel = createChannelHost({ core, sessions })

  ctx.effect(() => {
    const rpc = resolveConnectionRpc(ctx.connection)
    const unregister = rpc.handle(CHANNEL, channel.handler)
    return async () => {
      channel.dispose()
      await unregister?.()
    }
  }, '@rivus/dsh-estela: /estela rpc channel')
}

export function apply(ctx: HostContext): void {
  mountHost(ctx)
}
