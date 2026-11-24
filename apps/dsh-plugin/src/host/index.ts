import { CHANNEL } from '../contract/channel.ts'

export const name = '@rivus/dsh-estela'
export const inject = ['connection', 'webServer', 'sessionPersistence'] as const

export function apply(): void {
  void CHANNEL
}
