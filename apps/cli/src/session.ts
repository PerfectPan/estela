import type { Trace } from '@rivus/agent-trace-schema'
import type { SessionService, SessionView } from '@rivus/agent-trace-rpc'
import { claudeCodeAdapter } from '@rivus/agent-trace-host-claude-code'
import { codexAdapter } from '@rivus/agent-trace-host-codex'
import { grokAdapter } from '@rivus/agent-trace-host-grok'
import { loadTrace, redact, redactText } from '@rivus/agent-trace-kernel'
import { homeDir, nodeIO } from '@rivus/agent-trace-runtime-node'

const adapters = [claudeCodeAdapter, codexAdapter, grokAdapter]

export { adapters as registeredHosts }

export class Session implements SessionService {
  readonly path: string
  private readonly alwaysRedact: boolean
  private raw: Trace | undefined
  private cached: SessionView | undefined

  constructor(path: string, alwaysRedact: boolean, preloaded?: Trace) {
    this.path = path
    this.alwaysRedact = alwaysRedact
    this.raw = preloaded
  }

  async load(): Promise<Trace> {
    if (this.raw)
      return this.raw
    this.raw = await loadTrace(this.path, adapters, nodeIO)
    this.cached = undefined
    return this.raw
  }

  /** Redacts once. `build` and `mcp` always redact; the server honors `AGENT_TRACE_REDACT=0`. */
  async view(): Promise<SessionView> {
    if (this.cached)
      return this.cached
    const raw = this.raw ?? await this.load()
    if (!this.alwaysRedact && process.env.AGENT_TRACE_REDACT === '0') {
      this.cached = { path: this.path, trace: raw }
      return this.cached
    }
    const home = homeDir()
    this.cached = {
      path: redactText(this.path, home),
      trace: redact(raw, { homeDir: home }),
    }
    return this.cached
  }
}
