import type { ReconstructResult } from '@rivus/agent-trace-schema'
import type { DevframeNodeRpcSession, RpcStreamingChannel } from 'devframe'

type DevframeNodeRpcSessionMeta = DevframeNodeRpcSession['meta']
import type { EventDetail, LoadProgress, TraceStore, TraceViewResult } from '../trace-store.ts'
import { defineRpcFunction } from 'devframe'
import * as z from 'zod/mini'
import { parseInput } from './parse-input.ts'

/** Ref of the session the CLI was started with. The shell's session catalog resolves every listed ref. */
export const CURRENT_REF = 'current'

/** Streaming channel for load progress (bare name; DevFrame prefixes the namespace). */
export const LOAD_PROGRESS_CHANNEL = 'load-progress'

/** Progress chunks: at most one per this many milliseconds, plus the final one. */
const PROGRESS_INTERVAL_MS = 100

/**
 * A connection that calls `load-trace` must subscribe to the returned stream
 * within this time. DevFrame has no public connection-close hook, and only a
 * subscribed stream is aborted on disconnect, so an unsubscribed hold is
 * released after this grace period.
 *
 * Limitation: DevFrame 1.0.0 does not expose a stream's subscribers (the
 * channel's `get(id)` returns only the sink), so the check reads the calling
 * connection's `subscribedStreams`. DevFrame 1.0.0 does not reconnect a closed
 * WebSocket: when the socket drops, the browser shows "lost the connection"
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
function ownerOf(ctx: {
  rpc: { getCurrentRpcSession: () => { meta: DevframeNodeRpcSessionMeta } | undefined }
}): DevframeNodeRpcSessionMeta | undefined {
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

const LOAD_REF = 'load-trace needs a session ref'
const VIEW_REF = 'get-trace-view needs a session ref'
const EVENT_REF = 'get-event needs a session ref'
const EVENT_ID = 'get-event needs an event id'
const RECONSTRUCT_REF = 'reconstruct: ref must be a string; leave it out for the current session'
const RECONSTRUCT_ID = 'reconstruct needs an event id'

// Any string ref reaches the store, which answers `unknown session ref: …` for one it cannot resolve.
const loadTraceInput = z.object({ ref: z.string({ error: LOAD_REF }) }, { error: LOAD_REF })
const traceViewInput = z.object({ ref: z.string({ error: VIEW_REF }) }, { error: VIEW_REF })
const eventInput = z.object(
  { ref: z.string({ error: EVENT_REF }), id: z.string({ error: EVENT_ID }) },
  { error: `${EVENT_REF} and an event id` },
)
/** MCP calls name only `eventId`: without a `ref` (left out or null), reconstruct reads the launch session. */
const reconstructInput = z.object(
  { ref: z.nullish(z.string({ error: RECONSTRUCT_REF })), eventId: z.string({ error: RECONSTRUCT_ID }) },
  { error: RECONSTRUCT_ID },
)

export interface LoadTraceResult {
  /** Stream id on the `load-progress` channel. */
  loadId: string
  cached: boolean
  totalBytes: number
}

/**
 * Starts (or joins) the load of `ref` and returns a progress stream id.
 *
 * Browser contract: subscribe to `load-progress` with `loadId` immediately
 * (within `SUBSCRIBE_GRACE_MS`), then call `get-trace-view`. Two calls, because
 * DevFrame rejects a subscribe to a stream id that does not exist yet (DF0030).
 * Cancelling the subscription, disconnecting, never subscribing, or calling
 * `load-trace` again from the same connection releases this hold; the last
 * release aborts the load.
 */
export const loadTrace = defineRpcFunction({
  name: 'load-trace',
  type: 'action',
  jsonSerializable: true,
  setup: ctx => {
    let channel: RpcStreamingChannel<LoadProgress> | undefined
    const progressChannel = (): RpcStreamingChannel<LoadProgress> => {
      // Qualified with the rpc NAMESPACE (`agent-trace`); the scoped client subscribes by the bare name.
      channel ??= ctx.rpc.streaming.create<LoadProgress>(`agent-trace:${LOAD_PROGRESS_CHANNEL}`, { replayWindow: 1 })
      return channel
    }
    return {
      handler: async (input: { ref: string }): Promise<LoadTraceResult> => {
        const { ref } = parseInput(loadTraceInput, input)
        const owner = ownerOf(ctx)
        const handle = await requireStore().open(ref, owner)
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

export const getTraceView = defineRpcFunction({
  name: 'get-trace-view',
  type: 'query',
  jsonSerializable: true,
  setup: ctx => ({
    handler: async (input: { ref: string }): Promise<TraceViewResult> =>
      requireStore().view(parseInput(traceViewInput, input).ref, ownerOf(ctx)),
  }),
})

export const getEvent = defineRpcFunction({
  name: 'get-event',
  type: 'query',
  jsonSerializable: true,
  setup: ctx => ({
    handler: async (input: { ref: string; id: string }): Promise<EventDetail> => {
      const { ref, id } = parseInput(eventInput, input)
      return requireStore().event(ref, id, ownerOf(ctx))
    },
  }),
})

export const reconstructAt = defineRpcFunction({
  name: 'reconstruct',
  type: 'query',
  jsonSerializable: true,
  agent: {
    description:
      'Reconstruct the model-visible surface at one event id: context slots, recorded token counts, and events removed by compaction. Missing slots are unavailable, never invented. `ref` defaults to the session the server was started with.',
  },
  // No owner: MCP calls run outside an RPC session, and a reconstruct takes its own hold.
  setup: () => ({
    handler: async (input: { ref?: string; eventId: string }): Promise<ReconstructResult> => {
      const { ref, eventId } = parseInput(reconstructInput, input)
      return requireStore().reconstruct(ref ?? CURRENT_REF, eventId)
    },
  }),
})
