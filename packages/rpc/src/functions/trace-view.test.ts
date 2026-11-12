import type { Trace } from '@rivus/estela-schema'
import type { StreamSink } from 'devframe/utils/streaming-channel'
import type { LoadProgress } from '../trace-store.ts'
import type { TraceRpcContext } from './trace-view.ts'
import { createStreamSink } from 'devframe/utils/streaming-channel'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { TraceStore } from '../trace-store.ts'
import {
  bindTraceStore,
  CURRENT_TRACE_ID,
  getTraceView,
  loadTrace,
  reconstructAt,
  SUBSCRIBE_GRACE_MS,
} from './trace-view.ts'

const SIZE = 1000

function emptyTrace(id: string): Trace {
  return {
    schema: 'estela',
    agent: 'test',
    session: { id },
    capabilities: [],
    agents: [],
    events: [
      {
        id: 'u1',
        seq: 0,
        ts: 0,
        kind: 'user',
        payload: { text: id },
        source: { file: id, offset: 0, length: 1, line: 1 },
      },
    ],
    skipped: [],
  }
}

function harness() {
  const signals = new Map<string, AbortSignal>()
  const releases = new Map<string, () => void>()
  const progress = new Map<string, (bytes: number) => void>()
  const store = new TraceStore({
    resolve: traceId => ({ key: traceId, target: { path: traceId } }),
    fs: {
      read: async function* () {
        yield new Uint8Array()
      },
      stat: async () => ({ kind: 'file', size: SIZE, mtimeMs: 0 }),
    },
    load: (session, opts) =>
      new Promise((resolve, reject) => {
        signals.set(session.key, opts.signal)
        progress.set(session.key, opts.onProgress)
        releases.set(session.key, () => resolve({ trace: emptyTrace(session.key), canonical: false }))
        opts.signal.addEventListener('abort', () => reject(opts.signal.reason))
      }),
  })
  bindTraceStore(store)
  const sinks: StreamSink<LoadProgress>[] = []
  const chunks = new Map<string, LoadProgress[]>()
  const owner: { subscribedStreams?: Set<string> } = {}
  const ctx: TraceRpcContext = {
    rpc: {
      getCurrentRpcSession: () => ({ meta: owner }),
      streaming: {
        create: () => ({
          start: () => {
            const sink = createStreamSink<LoadProgress>({ replayWindow: 1 })
            const list: LoadProgress[] = []
            chunks.set(sink.id, list)
            sink.events.on('chunk', (_seq, chunk) => list.push(chunk))
            sinks.push(sink)
            return sink
          },
        }),
      },
    },
  }
  return { signals, releases, progress, sinks, chunks, ctx, owner }
}

/**
 * Runs a definition's optional `setup` against the context double and returns its handler, which
 * `setup` may itself leave out.
 */
async function handlerOf<T>(
  definition: { setup?: (context: TraceRpcContext) => { handler?: T } | Promise<{ handler?: T }> },
  ctx: TraceRpcContext,
): Promise<T> {
  if (!definition.setup) {
    throw new Error('definition has no setup')
  }
  const { handler } = await definition.setup(ctx)
  if (!handler) {
    throw new Error('setup produced no handler')
  }
  return handler
}

async function handlers(ctx: TraceRpcContext) {
  return {
    load: await handlerOf(loadTrace, ctx),
    view: await handlerOf(getTraceView, ctx),
    reconstruct: await handlerOf(reconstructAt, ctx),
  }
}

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('load-trace and get-trace-view', () => {
  it('streams progress before the view and closes the stream', async () => {
    const h = harness()
    const rpc = await handlers(h.ctx)
    const started = await rpc.load({ traceId: 'a' })
    expect(started).toMatchObject({ cached: false, totalBytes: SIZE })
    const viewing = rpc.view({ traceId: 'a' })
    await new Promise(resolve => setTimeout(resolve, 120))
    h.progress.get('a')!(400)
    h.releases.get('a')!()
    const view = await viewing
    await tick()
    expect(view.trace.events[0]!.payload.text).toBe('a')
    const sink = h.sinks[0]!
    expect(sink.id).toBe(started.loadId)
    expect(sink.closed).toBe(true)
    expect(h.chunks.get(sink.id)).toEqual([
      { bytesRead: 0, totalBytes: SIZE },
      { bytesRead: 400, totalBytes: SIZE },
      { bytesRead: SIZE, totalBytes: SIZE },
    ])
  })

  it('aborts the load when the browser cancels the progress stream (navigates away)', async () => {
    const h = harness()
    const rpc = await handlers(h.ctx)
    await rpc.load({ traceId: 'a' })
    const viewing = rpc.view({ traceId: 'a' })
    await tick()
    h.sinks[0]!.abort('cancelled by client')
    expect(h.signals.get('a')!.aborted).toBe(true)
    await expect(viewing).rejects.toThrow('load of a was cancelled')
  })

  it('aborts the previous load when the same connection opens another session', async () => {
    const h = harness()
    const rpc = await handlers(h.ctx)
    await rpc.load({ traceId: 'a' })
    const oldView = rpc.view({ traceId: 'a' })
    await rpc.load({ traceId: 'b' })
    expect(h.signals.get('a')!.aborted).toBe(true)
    expect(h.signals.get('b')!.aborted).toBe(false)
    await expect(oldView).rejects.toThrow('cancelled')
    await tick()
    expect(h.sinks[0]!.closed).toBe(true)
    h.releases.get('b')!()
    await expect(rpc.view({ traceId: 'b' })).resolves.toMatchObject({ traceId: 'b' })
  })

  it('reports a cached session at once and reconstruct defaults to the current trace id', async () => {
    const h = harness()
    const rpc = await handlers(h.ctx)
    const viewing = rpc.view({ traceId: CURRENT_TRACE_ID })
    await tick()
    h.releases.get(CURRENT_TRACE_ID)!()
    await viewing
    const again = await rpc.load({ traceId: CURRENT_TRACE_ID })
    expect(again.cached).toBe(true)
    await tick()
    expect(h.chunks.get(again.loadId)?.at(-1)).toEqual({ bytesRead: SIZE, totalBytes: SIZE })
    expect((await rpc.reconstruct({ eventId: 'u1' })).visibleIds).toEqual(['u1'])
  })

  describe('unsubscribed holds', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('releases a hold whose connection never subscribes, and keeps a subscribed one', async () => {
      vi.useFakeTimers()
      const h = harness()
      const rpc = await handlers(h.ctx)
      const left = await rpc.load({ traceId: 'a' })
      vi.advanceTimersByTime(SUBSCRIBE_GRACE_MS + 1)
      expect(h.signals.get('a')!.aborted).toBe(true)
      expect(h.sinks[0]!.id).toBe(left.loadId)

      const stays = await rpc.load({ traceId: 'b' })
      h.owner.subscribedStreams = new Set([`estela:load-progress\x1F${stays.loadId}`])
      vi.advanceTimersByTime(SUBSCRIBE_GRACE_MS + 1)
      expect(h.signals.get('b')!.aborted).toBe(false)
    })
  })
})
