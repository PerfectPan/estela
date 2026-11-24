import type { Trace } from '@rivus/estela-schema'
import type { StreamSink } from 'devframe/utils/streaming-channel'
import type { SessionsSignal } from '../list-types.ts'
import type { ReportTrace } from '../report.ts'
import type { LoadProgress } from '../trace-store.ts'
import type { TraceRpcContext } from './trace-view.ts'
import { fold } from '@rivus/estela-kernel'
import { createStreamSink } from 'devframe/utils/streaming-channel'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createReportFunctions, createReportSource, createServerFunctions, createSessionPublisher } from '../index.ts'
import { CURRENT_TRACE_ID, TraceStore } from '../trace-store.ts'
import { SUBSCRIBE_GRACE_MS } from './trace-view.ts'

const SIZE = 1000

function emptyTrace(id: string, text = id): Trace {
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
        payload: { text },
        source: { file: id, offset: 0, length: 1, line: 1 },
      },
    ],
    skipped: [],
  }
}

function harness(label = (key: string) => key) {
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
        releases.set(session.key, () =>
          resolve({ trace: emptyTrace(session.key, label(session.key)), canonical: false }),
        )
        opts.signal.addEventListener('abort', () => reject(opts.signal.reason))
      }),
  })
  const reportSource = createReportSource()
  const fns = createServerFunctions({ store, reportSource })
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
  return { store, fns, signals, releases, progress, sinks, chunks, ctx, owner }
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

async function handlers(h: ReturnType<typeof harness>) {
  const [, loadTrace, getTraceView, getEvent, reconstructAt] = h.fns
  return {
    load: await handlerOf(loadTrace, h.ctx),
    view: await handlerOf(getTraceView, h.ctx),
    event: await handlerOf(getEvent, h.ctx),
    reconstruct: await handlerOf(reconstructAt, h.ctx),
  }
}

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('load-trace and get-trace-view', () => {
  it('streams progress before the view and closes the stream', async () => {
    const h = harness()
    const rpc = await handlers(h)
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
    const rpc = await handlers(h)
    await rpc.load({ traceId: 'a' })
    const viewing = rpc.view({ traceId: 'a' })
    await tick()
    h.sinks[0]!.abort('cancelled by client')
    expect(h.signals.get('a')!.aborted).toBe(true)
    await expect(viewing).rejects.toThrow('load of a was cancelled')
  })

  it('aborts the previous load when the same connection opens another session', async () => {
    const h = harness()
    const rpc = await handlers(h)
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
    const rpc = await handlers(h)
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
      const rpc = await handlers(h)
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

describe('per-instance isolation', () => {
  it('keeps two function sets over two stores completely independent', async () => {
    const first = harness(key => `store-a:${key}`)
    const second = harness(key => `store-b:${key}`)
    const rpcA = await handlers(first)
    const rpcB = await handlers(second)

    const loadA = await rpcA.load({ traceId: 'shared' })
    expect(loadA.cached).toBe(false)
    const viewA = rpcA.view({ traceId: 'shared' })
    await tick()
    first.releases.get('shared')!()
    expect((await viewA).trace.events[0]!.payload.text).toBe('store-a:shared')

    // Store B must not see store A's cached trace for the same trace id.
    const loadB = await rpcB.load({ traceId: 'shared' })
    expect(loadB.cached).toBe(false)
    const viewB = rpcB.view({ traceId: 'shared' })
    await tick()
    second.releases.get('shared')!()
    expect((await viewB).trace.events[0]!.payload.text).toBe('store-b:shared')

    // Re-reading from set A still serves store A, not store B.
    expect((await rpcA.view({ traceId: 'shared' })).trace.events[0]!.payload.text).toBe('store-a:shared')
    expect((await rpcB.view({ traceId: 'shared' })).trace.events[0]!.payload.text).toBe('store-b:shared')
  })

  it('delivers each session publisher only to its own subscriber and buffers before bind', () => {
    const first = createSessionPublisher()
    const second = createSessionPublisher()
    const seenA: SessionsSignal[] = []
    const seenB: SessionsSignal[] = []

    first.emit({ revision: 1, pending: 2 })
    first.bind(signal => seenA.push(signal))
    second.bind(signal => seenB.push(signal))
    first.emit({ revision: 2, pending: 0 })
    second.emit({ revision: 9, pending: 1 })

    expect(seenA).toEqual([
      { revision: 1, pending: 2 },
      { revision: 2, pending: 0 },
    ])
    expect(seenB).toEqual([{ revision: 9, pending: 1 }])
  })

  it('keeps two report sources isolated across report-trace definitions', async () => {
    const sourceA = createReportSource()
    const sourceB = createReportSource()
    const [reportA] = createReportFunctions({ reportSource: sourceA })
    const [reportB] = createReportFunctions({ reportSource: sourceB })
    const makeReport = (id: string): ReportTrace => {
      const trace = emptyTrace(id)
      return {
        trace,
        summary: fold(trace),
        events: [],
        total: 1,
        truncated: false,
      }
    }

    sourceA.set(async () => makeReport('report-a'))
    sourceB.set(async () => makeReport('report-b'))

    const handlerA = (await reportA.setup!(undefined as never)).handler!
    const handlerB = (await reportB.setup!(undefined as never)).handler!
    expect((await handlerA()).trace.session.id).toBe('report-a')
    expect((await handlerB()).trace.session.id).toBe('report-b')
  })
})
