import type { Adapter } from '@agent-trace/kernel'
import type { Trace } from '@agent-trace/schema'
import { basename } from 'node:path'

/**
 * dsh sessions are a directory (JSONL generation + zstd frames) or a ZIP export.
 * Cold start: detect only. Load fails until format-catalog restore is wired.
 */
export const dshAdapter: Adapter = {
  id: 'dsh',
  async detect(path: string): Promise<boolean> {
    const name = basename(path)
    return name.endsWith('.zip')
      || /^session(\.v\d+)?\.jsonl(\.zst)?$/.test(name)
  },
  async load(path: string): Promise<Trace> {
    throw new Error(`dsh adapter cannot load ${path} yet: wire session-format-catalog restore; do not parse a single generation by hand`)
  },
}
