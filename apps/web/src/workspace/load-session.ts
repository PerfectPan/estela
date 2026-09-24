import type { SessionSummary } from '@rivus/agent-trace-kernel'
import type { EventDetail, LoadProgress } from '@rivus/agent-trace-rpc'
import type { Trace } from '@rivus/agent-trace-schema'
import { fold, summaryOf } from '@rivus/agent-trace-kernel'
import { createSignal, onCleanup } from 'solid-js'
import { devframeClient, isStaticBuild, scopedClient } from '@/shell/client.ts'

/** Must match `LOAD_PROGRESS_CHANNEL` in `@rivus/agent-trace-rpc` (the web app imports only its types). */
const LOAD_PROGRESS_CHANNEL = 'load-progress'

export interface LoadedSession {
  ref: string
  /** The view trace: strings capped, no originals (a static build keeps its originals). */
  trace: Trace
  summary: SessionSummary
  /** One event in full with its original record: `get-event`, or the static trace. */
  event: (id: string) => Promise<EventDetail>
}

/** A load failure split like the kernel's `host: <file>:<line>: <reason>` (plan 3.7). */
export interface LoadFailure {
  host?: string
  file?: string
  line?: number
  reason: string
}

export type LoadState =
  | { status: 'loading', bytesRead: number, totalBytes: number }
  | { status: 'ready', session: LoadedSession }
  | { status: 'error', failure: LoadFailure }

export function parseFailure(message: string): LoadFailure {
  const match = /^([\w.-]+): (.+?):(\d+): (.+)$/s.exec(message)
  if (!match)
    return { reason: message }
  return { host: match[1], file: match[2], line: Number(match[3]), reason: match[4]! }
}

function messageOf(error: unknown): string {
  if (error instanceof Error)
    return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string')
    return error.message
  return String(error)
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'LoadCancelledError'
}

async function staticSession(ref: string): Promise<LoadedSession> {
  const ctx = await scopedClient()
  const { trace } = await ctx.rpc.call('get-trace')
  const byId = new Map(trace.events.map(event => [event.id, event]))
  return {
    ref,
    trace,
    summary: summaryOf(fold(trace)),
    event: async (id) => {
      const found = byId.get(id)
      if (!found)
        throw new Error(`unknown event ${id}`)
      return found
    },
  }
}

/**
 * The workspace load flow (plan 3.5): `load-trace(ref)`, subscribe to `load-progress` with the
 * returned id at once (the server releases an unsubscribed hold after 5 s), then
 * `get-trace-view(ref)`. Leaving the route cancels the stream, which releases the hold.
 * After a WebSocket reconnect the load starts again: the new `load-trace` joins the running
 * load or gets the cached trace.
 */
export function createSessionLoad(ref: string) {
  const [state, setState] = createSignal<LoadState>({ status: 'loading', bytesRead: 0, totalBytes: 0 })
  let reader: { cancel: () => void } | undefined
  let dropped = false
  let attempt = 0
  let disposed = false
  let offStatus: (() => void) | undefined

  function stopReader(): void {
    reader?.cancel()
    reader = undefined
  }

  async function run(): Promise<void> {
    const mine = ++attempt
    stopReader()
    setState({ status: 'loading', bytesRead: 0, totalBytes: 0 })
    try {
      if (await isStaticBuild()) {
        const session = await staticSession(ref)
        if (mine === attempt && !disposed)
          setState({ status: 'ready', session })
        return
      }
      const ctx = await scopedClient()
      const started = await ctx.rpc.call('load-trace', { ref })
      if (mine !== attempt || disposed)
        return
      const stream = ctx.rpc.streaming.subscribe<LoadProgress>(LOAD_PROGRESS_CHANNEL, started.loadId)
      reader = stream
      setState({ status: 'loading', bytesRead: 0, totalBytes: started.totalBytes })
      void (async () => {
        for await (const chunk of stream) {
          if (mine !== attempt || disposed)
            break
          setState(current => current.status === 'loading' ? { status: 'loading', ...chunk } : current)
        }
      })().catch(() => {
        // The stream ends with the load's error; `get-trace-view` reports it.
      })
      const view = await ctx.rpc.call('get-trace-view', { ref })
      if (mine !== attempt || disposed)
        return
      setState({
        status: 'ready',
        session: {
          ref,
          trace: view.trace,
          summary: view.summary,
          event: id => ctx.rpc.call('get-event', { ref, id }),
        },
      })
    }
    catch (error) {
      if (mine !== attempt || disposed || isCancelled(error))
        return
      const client = await devframeClient().catch(() => undefined)
      // A dropped socket fails the call; the reconnect handler starts over.
      if (client && client.status !== 'connected' && client.status !== 'unauthorized')
        return
      setState({ status: 'error', failure: parseFailure(messageOf(error)) })
    }
  }

  void devframeClient().then((client) => {
    if (disposed || client.transport === 'static')
      return
    offStatus = client.events.on('connection:status', (status) => {
      if (status === 'disconnected' || status === 'error') {
        dropped = true
        return
      }
      if (status === 'connected' && dropped) {
        dropped = false
        if (state().status === 'loading')
          void run()
      }
    })
  }).catch(() => {})

  void run()

  onCleanup(() => {
    disposed = true
    attempt += 1
    stopReader()
    offStatus?.()
  })

  return { state, retry: () => void run() }
}
