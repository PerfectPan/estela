import type { Adapter } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'

/**
 * Claude Code sessions are JSONL under ~/.claude/projects/<cwd-hash>/.
 * Load must preserve parentUuid / sidechain as parentId, never invent turns.
 */
export const claudeCodeAdapter: Adapter = {
  id: 'claude-code',
  async detect(path: string): Promise<boolean> {
    return path.includes('.claude/projects')
  },
  async load(path: string): Promise<Trace> {
    throw new Error(`claude-code adapter cannot load ${path} yet: parse JSONL into events[] with parentId; do not flatten sidechains`)
  },
}
