import { CHANNEL } from '../contract/channel.ts'

export const inject = [] as const

export function apply(): void {
  void CHANNEL
}
