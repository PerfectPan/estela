import { mountHost } from './mount.ts'
import type { HostContext } from './rpc.ts'

export const name = '@rivus/dsh-estela'
export const inject = ['connection', 'webServer', 'sessionPersistence'] as const

export function apply(ctx: HostContext): void {
  mountHost(ctx)
}
