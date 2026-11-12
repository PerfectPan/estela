import type { ReconstructResult } from '@rivus/estela-schema'
import type { RpcStreamingChannel, RpcStreamingChannelOptions } from 'devframe'
import type { EventDetail, LoadProgress, TraceStore, TraceViewResult } from '../trace-store.ts'
import { createDefineWrapperWithContext } from 'devframe/rpc'
import * as z from 'zod/mini'
import { parseInput } from './parse-input.ts'

/** Trace id of the session the CLI was started with. The shell's session catalog resolves every listed one. */
export const CURRENT_TRACE_ID = 'current'

/** Streaming channel for load progress (bare name; DevFrame prefixes the namespace). */
export const LOAD_PROGRESS_CHANNEL = 'load-progress'

/** Progress chunks: at most one per this many milliseconds, plus the final one. */
const PROGRESS_INTERVAL_MS = 100

/**
 * What `load-trace` uses of a streaming channel: `start`, which yields the sink it writes to.
 */
interface LoadProgressChannel {
  start: RpcStreamingChannel<LoadProgress>['start']
}

/**
 * The context slice the trace functions read: the calling connection and the `load-progress`
 * channel.
 */
export interface TraceRpcContext {
  rpc: {
    /** `create` opens the `load-progress` channel. */
    streaming: { create: (name: string, opts?: RpcStreamingChannelOptions) => LoadProgressChannel }
    getCurrentRpcSession: () => { meta: { subscribedStreams?: Set<string> } } | undefined
  }
}

/**
 * devframe's root `defineRpcFunction` pins the full `DevframeNodeContext`, whose surface a test
 * double cannot honestly carry. The definitions are built with a wrapper bound to the slice they
 * read; the real context satisfies it where `apps/cli` registers them.
 */
const defineTraceFunction = createDefineWrapperWithContext<TraceRpcContext>()

/**
 * A connection that calls `load-trace` must subscribe to the returned stream
 * within this time. DevFrame has no public connection-close hook, and only a
 * subscribed stream is aborted on disconnect, so an unsubscribed hold is
 * released after this grace period.
 *
 * Limitation: DevFrame does not expose a stream's subscribers (the channel's
 * `get(id)` returns only the sink), so the check reads the calling
 * connection's `subscribedStreams`. A closed DevFrame client never reconnects,
 * by design: when the socket drops, the browser shows "lost the connection"
 * and a reload, whose new `load-trace` joins the running load or gets the
 * cached trace.
 */
export const SUBSCRIBE_GRACE_MS = 5000

function subscribed(meta: { subscribedStreams?: Set<string> } | undefined, id: string): boolean {
  // DevFrame keys these as `<channel>\x1F<id>`.
  for (const key of meta?.subscribedStreams ?? []) {
    if (key.endsWith(`\x1F${id}`)) {
      return true
    }
  }
  return false
}

let store: TraceStore | undefined

/**
 * The calling browser connection, or `undefined` outside a WebSocket/SSE call
 * (MCP and in-process calls, where DevFrame throws DF0007 instead).
 */
function ownerOf(ctx: TraceRpcContext): { subscribedStreams?: Set<string> } | undefined {
  try {
    return ctx.rpc.getCurrentRpcSession()?.meta
  } catch {
    return undefined
  }
}

export function bindTraceStore(next: TraceStore): void {
  store = next
}

function requireStore(): TraceStore {
  if (!store) {
    throw new Error('trace store is not bound')
  }
  return store
}

const LOAD_TRACE_ID = 'load-trace needs a trace id'
const VIEW_TRACE_ID = 'get-trace-view needs a trace id'
const EVENT_TRACE_ID = 'get-event needs a trace id'
const EVENT_ID = 'get-event needs an event id'
const RECONSTRUCT_TRACE_ID = 'reconstruct: traceId must be a string; leave it out for the current session'
const RECONSTRUCT_ID = 'reconstruct needs an event id'

// Any string trace id reaches the store, which answers `unknown trace id: …` for one it cannot resolve.
const loadTraceInput = z.object({ traceId: z.string({ error: LOAD_TRACE_ID }) }, { error: LOAD_TRACE_ID })
const traceViewInput = z.object({ traceId: z.string({ error: VIEW_TRACE_ID }) }, { error: VIEW_TRACE_ID })
const eventInput = z.object(
  { traceId: z.string({ error: EVENT_TRACE_ID }), id: z.string({ error: EVENT_ID }) },
  { error: `${EVENT_TRACE_ID} and an event id` },
)
/** Without a `traceId` (left out or null), reconstruct reads the launch session. */
const reconstructInput = z.object(
  { traceId: z.nullish(z.string({ error: RECONSTRUCT_TRACE_ID })), eventId: z.string({ error: RECONSTRUCT_ID }) },
  { error: RECONSTRUCT_ID },
)

export interface LoadTraceResult {
  /** Stream id on the `load-progress` channel. */
  loadId: string
  cached: boolean
  totalBytes: number
}

/**
 * Starts (or joins) the load of `traceId` and returns a progress stream id.
 *
 * Browser contract: subscribe to `load-progress` with `loadId` immediately
 * (within `SUBSCRIBE_GRACE_MS`), then call `get-trace-view`. Two calls, because
 * DevFrame rejects a subscribe to a stream id that does not exist yet (DF0030).
 * Cancelling the subscription, disconnecting, never subscribing, or calling
 * `load-trace` again from the same connection releases this hold; the last
 * release aborts the load.
 */
export const loadTrace = defineTraceFunction({
  name: 'load-trace',
  type: 'action',
  jsonSerializable: true,
  setup: (ctx: TraceRpcContext) => {
    let channel: LoadProgressChannel | undefined
    const progressChannel = (): LoadProgressChannel => {
      // Qualified with the rpc NAMESPACE (`estela`); the scoped client subscribes by the bare name.
      channel ??= ctx.rpc.streaming.create(`estela:${LOAD_PROGRESS_CHANNEL}`, { replayWindow: 1 })
      return channel
    }
    return {
      handler: async (input: { traceId: string }): Promise<LoadTraceResult> => {
        const { traceId } = parseInput(loadTraceInput, input)
        const owner = ownerOf(ctx)
        const handle = await requireStore().open(traceId, owner)
        const sink = progressChannel().start()
        const first = handle.progress()
        sink.write(first)
        let last = Date.now()
        const off = handle.onProgress(progress => {
          const now = Date.now()
          if (now - last < PROGRESS_INTERVAL_MS) {
            return
          }
          last = now
          sink.write(progress)
        })
        const grace = setTimeout(() => {
          if (!subscribed(owner, sink.id)) {
            sink.abort('not subscribed')
          }
        }, SUBSCRIBE_GRACE_MS)
        grace.unref()
        sink.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(grace)
            off()
            handle.release()
          },
          { once: true },
        )
        handle.done.then(
          () => {
            off()
            if (!sink.closed) {
              sink.write(handle.progress())
              sink.close()
            }
          },
          (error: unknown) => {
            off()
            sink.error(error)
          },
        )
        return { loadId: sink.id, cached: handle.cached, totalBytes: first.totalBytes }
      },
    }
  },
})

export const getTraceView = defineTraceFunction({
  name: 'get-trace-view',
  type: 'query',
  jsonSerializable: true,
  setup: (ctx: TraceRpcContext) => ({
    handler: async (input: { traceId: string }): Promise<TraceViewResult> =>
      requireStore().view(parseInput(traceViewInput, input).traceId, ownerOf(ctx)),
  }),
})

export const getEvent = defineTraceFunction({
  name: 'get-event',
  type: 'query',
  jsonSerializable: true,
  setup: (ctx: TraceRpcContext) => ({
    handler: async (input: { traceId: string; id: string }): Promise<EventDetail> => {
      const { traceId, id } = parseInput(eventInput, input)
      return requireStore().event(traceId, id, ownerOf(ctx))
    },
  }),
})

export const reconstructAt = defineTraceFunction({
  name: 'reconstruct',
  type: 'query',
  jsonSerializable: true,
  // Not an agent tool: `estela_reconstruct` is registered by the server's agent tools, which give it a named input
  // schema and bound its result. No owner: a reconstruct takes its own hold.
  setup: () => ({
    handler: async (input: { traceId?: string; eventId: string }): Promise<ReconstructResult> => {
      const { traceId, eventId } = parseInput(reconstructInput, input)
      return requireStore().reconstruct(traceId ?? CURRENT_TRACE_ID, eventId)
    },
  }),
})
