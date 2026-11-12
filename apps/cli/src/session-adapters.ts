import { builtinProviders, type Provider } from '@rivus/agent-kit/providers'
import type { SessionAdapter, SessionAdapters } from '@rivus/agent-kit/sessions'

export const builtinAdapters: SessionAdapters = Object.fromEntries(
  builtinProviders.flatMap(provider => (provider.sessions ? [[provider.id, provider.sessions]] : [])),
)

/**
 * The product name the rail, the list, and the picker show. The kit's OpenCode adapter names itself
 * with its id, while the workspace and the README call it OpenCode.
 */
export function adapterDisplayName(adapter: SessionAdapter): string {
  return adapter.agent === 'opencode' ? 'OpenCode' : adapter.displayName
}

/** Adapt the shell's reader registry to the kit's provider SPI. */
export function sessionProviders(adapters: SessionAdapters): Provider[] {
  return Object.values(adapters).flatMap(adapter => (adapter ? [{ id: adapter.agent, sessions: adapter }] : []))
}
