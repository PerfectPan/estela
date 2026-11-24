import type { LocaleRuntime, LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { ThemeRuntime, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { ComponentType } from 'react'
import type { CHANNEL, ChannelEndpoint, ChannelInput, ChannelResult } from '../contract/channel.ts'

export interface ClientRpcFailure {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

export type ClientRpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ClientRpcFailure }

export interface ClientRpc {
  call<E extends ChannelEndpoint>(
    channel: typeof CHANNEL,
    endpoint: E,
    payload: ChannelInput<E>,
    signal?: AbortSignal,
  ): Promise<ClientRpcResult<ChannelResult<E>>>
}

interface ConversationViewEntry<P> {
  readonly name: 'conversation.view'
  readonly id: string
  readonly order: number
  readonly label: string
  inject(sessionId: string): P
}

interface ClientSlots {
  inject(name: string, register: () => () => void): () => void
  register<P>(entry: ConversationViewEntry<P>, component: ComponentType<P>): () => void
}

export interface AppearanceContext {
  readonly theme: Pick<ThemeRuntime, 'getTheme'>
  readonly locale: Pick<LocaleRuntime, 'getLocale'>
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  on(event: 'locale/change', listener: (snapshot: LocaleSnapshot) => void): () => void
  effect(callback: () => (() => void) | void, label?: string): () => void
}

export interface DshClientContext extends AppearanceContext {
  readonly slots: ClientSlots
  readonly connection: { readonly rpc: ClientRpc }
}
