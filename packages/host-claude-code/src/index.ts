import type { Adapter, TraceIO } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import { basenamePath } from '@rivus/agent-trace-kernel'

/**
 * Claude Code sessions are JSONL under ~/.claude/projects/<cwd-hash>/.
 * Load must preserve parentUuid / sidechain as parentId, never invent turns.
 */
export const claudeCodeAdapter: Adapter = {
  id: 'claude-code',
  async detect(path: string, _io: TraceIO): Promise<boolean> {
    if (path.includes('.claude/projects'))
      return true
    if (!basenamePath(path).endsWith('.jsonl'))
      return false
    return false
  },
  async load(path: string, _io: TraceIO): Promise<Trace> {
    throw new Error(`claude-code adapter cannot load ${path} yet: parse JSONL into events[] with parentId; do not flatten sidechains`)
  },
}
