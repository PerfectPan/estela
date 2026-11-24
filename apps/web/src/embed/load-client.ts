import type { LoadClient } from '@/workspace/load-session.ts'
import type { WorkspaceSource } from './source.ts'

/**
 * Adapts a `WorkspaceSource` to the `LoadClient` that `createSessionLoad` takes.
 * `loadTrace` resolves immediately with `totalBytes: 0` so the loading panel shows the
 * indeterminate indicator, `subscribe` yields nothing, `traceView` calls `open()`, and
 * `event` calls `event(id)`.
 */
export function createSourceClient(source: WorkspaceSource): LoadClient {
  return {
    status: 'connected',
    onStatus: () => () => {},
    loadTrace: async () => ({ loadId: '', cached: false, totalBytes: 0 }),
    traceView: async () => source.open(),
    event: async (_traceId, id) => source.event(id),
    subscribe: () => ({
      cancel: () => {},
      async *[Symbol.asyncIterator]() {
        // Embed sources do not stream byte progress; LoadingPanel falls back to "Loading…".
      },
    }),
  }
}
