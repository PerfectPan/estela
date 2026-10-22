import { builtinProviders, type Provider } from '@rivus/agent-kit/providers'
import type { SessionAdapters } from '@rivus/agent-kit/sessions'

export const builtinAdapters: SessionAdapters = Object.fromEntries(
  builtinProviders.flatMap(provider => (provider.sessions ? [[provider.id, provider.sessions]] : [])),
)

export function sessionProviders(adapters: SessionAdapters): Provider[] {
  return Object.values(adapters).flatMap(adapter => (adapter ? [{ id: adapter.agent, sessions: adapter }] : []))
}
