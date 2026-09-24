import type { Adapter, TraceIO } from '@rivus/agent-trace-kernel'
import type { Trace } from '@rivus/agent-trace-schema'
import { basenamePath } from '@rivus/agent-trace-kernel'

/**
 * dsh sessions are a directory (JSONL generation + zstd frames) or a ZIP export.
 * Cold start: detect only. Load fails until format-catalog restore is wired.
 * Not registered in this release.
 */
export const dshAdapter: Adapter = {
  id: 'dsh',
  async detect(path: string, _io: TraceIO): Promise<boolean> {
    const name = basenamePath(path)
    return name.endsWith('.zip')
      || /^session(\.v\d+)?\.jsonl(\.zst)?$/.test(name)
  },
  async load(path: string, _io: TraceIO): Promise<Trace> {
    throw new Error(`dsh adapter cannot load ${path} yet: wire session-format-catalog restore; do not parse a single generation by hand`)
  },
}
