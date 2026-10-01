import type { Trace } from '@rivus/agent-trace-schema'
import { claudeCodeAdapter } from '@rivus/agent-trace-host-claude-code'
import { codexAdapter } from '@rivus/agent-trace-host-codex'
import { grokAdapter } from '@rivus/agent-trace-host-grok'
import { loadTrace } from '@rivus/agent-trace-kernel'
import { nodeIO } from '@rivus/agent-trace-runtime-node'

export const registeredHosts = [claudeCodeAdapter, codexAdapter, grokAdapter]

/** The one session `build` and `mcp` work on: loaded once, with its original records. */
export function sessionLoader(path: string): () => Promise<Trace> {
  let loaded: Promise<Trace> | undefined
  return () => {
    loaded ??= loadTrace(path, registeredHosts, nodeIO)
    return loaded
  }
}
