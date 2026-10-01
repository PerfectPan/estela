import type { HostAdapter } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import { basenamePath } from '@rivus/agent-trace-kernel'

/**
 * dsh sessions are a directory (JSONL generation + zstd frames) or a ZIP export.
 * Cold start: detect only. Load fails until format-catalog restore is wired.
 * Not registered in this release.
 */
export const dshAdapter: HostAdapter = {
  id: 'dsh',
  displayName: 'dsh',
  capabilities: [],
  roots() {
    return []
  },
  async *discover() {},
  async detect(ref): Promise<boolean> {
    const name = basenamePath(ref.path)
    return name.endsWith('.zip') || /^session(\.v\d+)?\.jsonl(\.zst)?$/.test(name)
  },
  async load(ref): Promise<Trace> {
    throw new Error(
      `dsh adapter cannot load ${ref.path} yet: wire session-format-catalog restore; do not parse a single generation by hand`,
    )
  },
}
