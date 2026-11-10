import { builtinProviders, type Provider } from '@rivus/agent-kit/providers'
import { dshPluginSessionAdapter } from './dsh-plugin-adapter.ts'
import type { SessionAdapters } from '@rivus/agent-kit/sessions'

export const builtinAdapters: SessionAdapters = Object.fromEntries(
  builtinProviders.flatMap(provider => (provider.sessions ? [[provider.id, provider.sessions]] : [])),
)

/** Default readers include our capture adapter; resolve its optional directory from the injected environment. */
export function defaultAdapters(env: Readonly<Record<string, string | undefined>>): SessionAdapters {
  const tracesDir = env.DSH_AGENT_TRACE_DIR
  return {
    ...builtinAdapters,
    'dsh-plugin': tracesDir ? { ...dshPluginSessionAdapter, roots: () => [tracesDir] } : dshPluginSessionAdapter,
  }
}

/** Adapt the shell's reader registry to the kit's provider SPI. */
export function sessionProviders(adapters: SessionAdapters): Provider[] {
  return Object.values(adapters).flatMap(adapter => (adapter ? [{ id: adapter.agent, sessions: adapter }] : []))
}
