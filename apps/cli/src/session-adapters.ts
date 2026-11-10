import { builtinProviders, type Provider } from '@rivus/agent-kit/providers'
import type { SessionAdapter, SessionAdapters } from '@rivus/agent-kit/sessions'

export const builtinAdapters: SessionAdapters = Object.fromEntries(
  builtinProviders.flatMap(provider => (provider.sessions ? [[provider.id, provider.sessions]] : [])),
)

/** Keep the kit's layout-specific Gemini detection ahead of Claude's broad JSONL head match. */
function orderedDetection(adapter: SessionAdapter): SessionAdapter {
  if (adapter !== builtinAdapters['claude-code']) {
    return adapter
  }
  return {
    ...adapter,
    async detect(platform, ref) {
      if (await builtinAdapters['gemini-cli']!.detect(platform, ref)) {
        return false
      }
      return adapter.detect(platform, ref)
    },
  }
}

/** Adapt shell readers to kit providers, preserving explicit caller overrides. */
export function sessionProviders(adapters: SessionAdapters): Provider[] {
  return Object.values(adapters).flatMap(adapter =>
    adapter ? [{ id: adapter.agent, sessions: orderedDetection(adapter) }] : [],
  )
}
