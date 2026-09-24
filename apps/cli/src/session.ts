import type { Trace } from '@rivus/agent-trace-schema'
import type { SessionService } from '@rivus/agent-trace-rpc'
import { claudeCodeAdapter } from '@rivus/agent-trace-host-claude-code'
import { codexAdapter } from '@rivus/agent-trace-host-codex'
import { grokAdapter } from '@rivus/agent-trace-host-grok'
import { loadTrace, redact } from '@rivus/agent-trace-kernel'
import { bindSessionService } from '@rivus/agent-trace-rpc'
import { homeDir, nodeIO } from '@rivus/agent-trace-runtime-node'

const adapters = [grokAdapter, codexAdapter, claudeCodeAdapter]

export type SessionMode = 'server' | 'build' | 'mcp'

export class Session implements SessionService {
  path: string
  readonly mode: SessionMode
  private raw: Trace | undefined

  constructor(path: string, mode: SessionMode) {
    this.path = path
    this.mode = mode
  }

  async load(): Promise<Trace> {
    this.raw = await loadTrace(this.path, adapters, nodeIO)
    return this.raw
  }

  async currentTrace(): Promise<Trace> {
    const raw = this.raw ?? await this.load()
    if (this.mode !== 'build' && process.env.AGENT_TRACE_REDACT === '0')
      return raw
    return redact(raw, { homeDir: homeDir() })
  }

  bind(): void {
    bindSessionService(this)
  }
}

/** M3 replaces this with the session index. */
export function listSessionChoices(currentPath: string): { value: string, label: string }[] {
  return [{ value: currentPath, label: currentPath }]
}
