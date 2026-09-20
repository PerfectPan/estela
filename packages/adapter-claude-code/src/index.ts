import type { Adapter } from '@agent-trace/kernel'
import type { Trace } from '@agent-trace/schema'
import { basename } from 'node:path'

/**
 * Claude Code sessions are JSONL under ~/.claude/projects/<cwd-hash>/.
 * Load must preserve parentUuid / sidechain as parentId, never invent turns.
 */
export const claudeCodeAdapter: Adapter = {
  id: 'claude-code',
  async detect(path: string): Promise<boolean> {
    if (path.includes('.claude/projects'))
      return true
    if (!basename(path).endsWith('.jsonl'))
      return false
    return false
  },
  async load(path: string): Promise<Trace> {
    throw new Error(`claude-code adapter cannot load ${path} yet: parse JSONL into events[] with parentId; do not flatten sidechains`)
  },
}
