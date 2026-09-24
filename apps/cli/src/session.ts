import type { Trace } from '@rivus/agent-trace-schema'
import type { SessionService, SessionView } from '@rivus/agent-trace-rpc'
import { claudeCodeAdapter } from '@rivus/agent-trace-host-claude-code'
import { codexAdapter } from '@rivus/agent-trace-host-codex'
import { grokAdapter } from '@rivus/agent-trace-host-grok'
import { loadTrace, redact, redactText } from '@rivus/agent-trace-kernel'
import { homeDir, nodeIO } from '@rivus/agent-trace-runtime-node'

export const registeredHosts = [claudeCodeAdapter, codexAdapter, grokAdapter]

export class Session implements SessionService {
  readonly path: string
  private readonly redacts: boolean
  private raw: Trace | undefined
  private cached: SessionView | undefined

  /** `redacts` is decided once in `main`: always for `build` and `mcp`; the server honors `AGENT_TRACE_REDACT=0`. */
  constructor(path: string, redacts: boolean) {
    this.path = path
    this.redacts = redacts
  }

  async load(): Promise<Trace> {
    if (this.raw)
      return this.raw
    this.raw = await loadTrace(this.path, registeredHosts, nodeIO)
    this.cached = undefined
    return this.raw
  }

  /** Redacts once. */
  async view(): Promise<SessionView> {
    if (this.cached)
      return this.cached
    const raw = this.raw ?? await this.load()
    if (!this.redacts) {
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
