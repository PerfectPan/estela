import type { Trace } from '@rivus/agent-trace-schema'
import type { StreamSink } from 'devframe/utils/streaming-channel'
import type { LoadProgress } from '../trace-store.ts'
import { createStreamSink } from 'devframe/utils/streaming-channel'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { TraceStore } from '../trace-store.ts'
import {
  bindTraceStore,
  CURRENT_REF,
  getTraceView,
  loadTrace,
  reconstructAt,
  SUBSCRIBE_GRACE_MS,
} from './trace-view.ts'

const SIZE = 1000

function emptyTrace(id: string): Trace {
  return {
    schema: 'agent-trace',
    agent: { id: 'test' },
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
    resolve: ref => ({ key: ref, path: ref }),
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
  const ctx = {
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

async function handlers(ctx: unknown) {
  const setup = loadTrace.setup as (
    context: unknown,
  ) => Promise<{ handler: (args: { ref: string }) => Promise<{ loadId: string; totalBytes: number; cached: boolean }> }>
  const view = getTraceView.setup as (
    context: unknown,
  ) => Promise<{ handler: (args: { ref: string }) => Promise<{ ref: string; trace: Trace }> }>
  const rebuild = reconstructAt.setup as (
    context: unknown,
  ) => Promise<{ handler: (args: { ref?: string; eventId: string }) => Promise<{ visibleIds: string[] }> }>
  return {
    load: (await setup(ctx)).handler,
    view: (await view(ctx)).handler,
    reconstruct: (await rebuild(ctx)).handler,
  }
}

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('load-trace and get-trace-view', () => {
  it('streams progress before the view and closes the stream', async () => {
    const h = harness()
    const rpc = await handlers(h.ctx)
    const started = await rpc.load({ ref: 'a' })
    expect(started).toMatchObject({ cached: false, totalBytes: SIZE })
    const viewing = rpc.view({ ref: 'a' })
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
    await rpc.load({ ref: 'a' })
    const viewing = rpc.view({ ref: 'a' })
    await tick()
    h.sinks[0]!.abort('cancelled by client')
    expect(h.signals.get('a')!.aborted).toBe(true)
    await expect(viewing).rejects.toThrow('load of a was cancelled')
  })

  it('aborts the previous load when the same connection opens another session', async () => {
    const h = harness()
    const rpc = await handlers(h.ctx)
    await rpc.load({ ref: 'a' })
    const oldView = rpc.view({ ref: 'a' })
    await rpc.load({ ref: 'b' })
    expect(h.signals.get('a')!.aborted).toBe(true)
    expect(h.signals.get('b')!.aborted).toBe(false)
    await expect(oldView).rejects.toThrow('cancelled')
    await tick()
    expect(h.sinks[0]!.closed).toBe(true)
    h.releases.get('b')!()
    await expect(rpc.view({ ref: 'b' })).resolves.toMatchObject({ ref: 'b' })
  })

  it('reports a cached session at once and reconstruct defaults to the current ref', async () => {
    const h = harness()
    const rpc = await handlers(h.ctx)
    const viewing = rpc.view({ ref: CURRENT_REF })
    await tick()
    h.releases.get(CURRENT_REF)!()
    await viewing
    const again = await rpc.load({ ref: CURRENT_REF })
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
      const left = await rpc.load({ ref: 'a' })
      vi.advanceTimersByTime(SUBSCRIBE_GRACE_MS + 1)
      expect(h.signals.get('a')!.aborted).toBe(true)
      expect(h.sinks[0]!.id).toBe(left.loadId)

      const stays = await rpc.load({ ref: 'b' })
      h.owner.subscribedStreams = new Set([`agent-trace:load-progress\x1F${stays.loadId}`])
      vi.advanceTimersByTime(SUBSCRIBE_GRACE_MS + 1)
      expect(h.signals.get('b')!.aborted).toBe(false)
    })
  })
})
