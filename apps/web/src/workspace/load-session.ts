import type { SessionSummary } from '@rivus/agent-trace-kernel'
import type { EventDetail, LoadProgress, LoadTraceResult, ReportTrace, TraceViewResult } from '@rivus/agent-trace-rpc'
import type { Trace } from '@rivus/agent-trace-schema'
import { createSignal, onCleanup } from 'solid-js'
import { devframeClient, scopedClient } from '@/shell/client.ts'

/** Must match `LOAD_PROGRESS_CHANNEL` in `@rivus/agent-trace-rpc` (the web app imports only its types). */
const LOAD_PROGRESS_CHANNEL = 'load-progress'

/** A report holds the first events in full; any other event comes back as its view with `notInReport`. */
export type SessionEvent = EventDetail & { notInReport?: true }

export interface LoadedSession {
  ref: string
  /** The view trace: strings capped, no originals. */
  trace: Trace
  summary: SessionSummary
  /** One event in full with its original record: `get-event`, or the report's included events. */
  event: (id: string) => Promise<SessionEvent>
}

/** A load failure split like the kernel's `host: <file>:<line>: <reason>` (plan 3.7). */
export interface LoadFailure {
  host?: string
  file?: string
  line?: number
  reason: string
  /** The WebSocket closed: DevFrame 1.0.0 does not reconnect, so only a reload helps. */
  lost?: boolean
}

type LoadState =
  | { status: 'loading', bytesRead: number, totalBytes: number }
  | { status: 'ready', session: LoadedSession }
  | { status: 'error', failure: LoadFailure }

function parseFailure(message: string): LoadFailure {
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

type ConnectionStatus = 'connecting' | 'connected' | 'unauthorized' | 'disconnected' | 'error'

/** The part of the DevFrame client the load flow uses; tests pass a fake. */
export interface LoadClient {
  status: ConnectionStatus
  onStatus: (listener: (status: ConnectionStatus) => void) => () => void
  call: {
    (method: 'load-trace', input: { ref: string }): Promise<LoadTraceResult>
    (method: 'get-trace-view', input: { ref: string }): Promise<TraceViewResult>
    (method: 'get-event', input: { ref: string, id: string }): Promise<EventDetail>
  }
  subscribe: (channel: string, id: string) => AsyncIterable<LoadProgress> & { cancel: () => void }
}

async function defaultClient(): Promise<LoadClient> {
  const base = await devframeClient()
  const ctx = await scopedClient()
  return {
    get status() {
      return base.status
    },
    onStatus: listener => base.events.on('connection:status', status => listener(status)),
    call: ((method: string, input: unknown) => ctx.rpc.call(method, input)) as LoadClient['call'],
    subscribe: (channel, id) => ctx.rpc.streaming.subscribe<LoadProgress>(channel, id),
  }
}

function lostFailure(): LoadFailure {
  return { reason: 'connection lost', lost: true }
}

/**
 * The workspace load flow (plan 3.5): `load-trace(ref)`, subscribe to `load-progress` with the
 * returned id at once (the server releases an unsubscribed hold after 5 s), then
 * `get-trace-view(ref)`. Leaving the route cancels the stream, which releases the hold.
 * DevFrame 1.0.0 never reconnects a closed WebSocket, so a drop during the load ends it with
 * a "lost the connection" failure; the page offers a reload.
 */
export function createSessionLoad(ref: string, connect: () => Promise<LoadClient> = defaultClient) {
  const [state, setState] = createSignal<LoadState>({ status: 'loading', bytesRead: 0, totalBytes: 0 })
  let reader: { cancel: () => void } | undefined
  let attempt = 0
  let disposed = false
  let offStatus: (() => void) | undefined

  function stopReader(): void {
    reader?.cancel()
    reader = undefined
  }

  function fail(failure: LoadFailure): void {
    stopReader()
    setState({ status: 'error', failure })
  }

  async function run(): Promise<void> {
    const mine = ++attempt
    stopReader()
    setState({ status: 'loading', bytesRead: 0, totalBytes: 0 })
    let client: LoadClient | undefined
    try {
      client = await connect()
      if (mine !== attempt || disposed)
        return
      offStatus?.()
      offStatus = client.onStatus((status) => {
        if ((status === 'disconnected' || status === 'error') && state().status === 'loading' && !disposed)
          fail(lostFailure())
      })
      if (client.status === 'disconnected' || client.status === 'error')
        return fail(lostFailure())
      const started = await client.call('load-trace', { ref })
      if (mine !== attempt || disposed)
        return
      const stream = client.subscribe(LOAD_PROGRESS_CHANNEL, started.loadId)
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
      const view = await client.call('get-trace-view', { ref })
      if (mine !== attempt || disposed || state().status === 'error')
        return
      const live = client
      setState({
        status: 'ready',
        session: { ref, trace: view.trace, summary: view.summary, event: id => live.call('get-event', { ref, id }) },
      })
    }
    catch (error) {
      if (mine !== attempt || disposed || isCancelled(error) || state().status === 'error')
        return
      if (client && (client.status === 'disconnected' || client.status === 'error'))
        return fail(lostFailure())
      fail(parseFailure(messageOf(error)))
    }
  }

  void run()

  onCleanup(() => {
    disposed = true
    attempt += 1
    stopReader()
    offStatus?.()
  })

  return { state, retry: () => void run() }
}

/** Report mode: the baked `report-trace` is the whole session; nothing is loaded. */
export function reportSession(report: ReportTrace): LoadedSession {
  const full = new Map(report.events.map(event => [event.id, event]))
  const view = new Map(report.trace.events.map(event => [event.id, event]))
  return {
    ref: '',
    trace: report.trace,
    summary: report.summary,
    event: async (id) => {
      const found = full.get(id)
      if (found)
        return found
      const shown = view.get(id)
      if (!shown)
        throw new Error(`unknown event ${id}`)
      return { ...shown, notInReport: true }
    },
  }
}
