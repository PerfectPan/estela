import type { SessionSummary } from '@rivus/agent-kit/transcript'
import type { EventDetail, LoadProgress, LoadTraceResult, ReportTrace, TraceViewResult } from '@rivus/estela-rpc'
import type { Trace } from '@rivus/estela-schema'
import { createSignal, onCleanup } from 'solid-js'
import { messageOf } from '@/lib/error-message.ts'
import { devframeClient, scopedClient } from '@/shell/client.ts'

/** Must match `LOAD_PROGRESS_CHANNEL` in `@rivus/estela-rpc` (the web app imports only its types). */
const LOAD_PROGRESS_CHANNEL = 'load-progress'

/** A report holds the first events in full; any other event comes back as its view with `notInReport`. */
export type SessionEvent = EventDetail & { notInReport?: true }

export interface LoadedSession {
  traceId: string
  /** The view trace: strings capped, no originals. */
  trace: Trace
  summary: SessionSummary
  /** One event in full with its original record: `get-event`, or the report's included events. */
  event: (id: string) => Promise<SessionEvent>
}

/** A load failure split like the CLI's `agent: <file>:<line>: <reason>` message. */
export interface LoadFailure {
  agent?: string
  file?: string
  line?: number
  reason: string
  /** The WebSocket closed: a closed DevFrame client never reconnects, so only a reload helps. */
  lost?: boolean
}

type LoadState =
  | { status: 'loading'; bytesRead: number; totalBytes: number }
  | { status: 'ready'; session: LoadedSession }
  | { status: 'error'; failure: LoadFailure }

function parseFailure(message: string): LoadFailure {
  const match = /^([\w.-]+): (.+?):(\d+): (.+)$/s.exec(message)
  if (!match) {
    return { reason: message }
  }
  return { agent: match[1], file: match[2], line: Number(match[3]), reason: match[4]! }
}

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'LoadCancelledError'
}

type ConnectionStatus = 'connecting' | 'connected' | 'unauthorized' | 'disconnected' | 'error'

/** The part of the DevFrame client the load flow uses, one typed method per call; tests pass a fake. */
export interface LoadClient {
  status: ConnectionStatus
  onStatus: (listener: (status: ConnectionStatus) => void) => () => void
  /** `load-trace` */
  loadTrace: (traceId: string) => Promise<LoadTraceResult>
  /** `get-trace-view` */
  traceView: (traceId: string) => Promise<TraceViewResult>
  /** `get-event` */
  event: (traceId: string, id: string) => Promise<EventDetail>
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
    loadTrace: traceId => ctx.rpc.call('load-trace', { traceId }),
    traceView: traceId => ctx.rpc.call('get-trace-view', { traceId }),
    event: (traceId, id) => ctx.rpc.call('get-event', { traceId, id }),
    subscribe: (channel, id) => ctx.rpc.streaming.subscribe<LoadProgress>(channel, id),
  }
}

function lostFailure(): LoadFailure {
  return { reason: 'connection lost', lost: true }
}

/**
 * The workspace load flow: `load-trace(traceId)`, subscribe to `load-progress` with the
 * returned id at once (the server releases an unsubscribed hold after 5 s), then
 * `get-trace-view(traceId)`. Leaving the route cancels the stream, which releases the hold.
 * A closed DevFrame client never reconnects, by design, so a drop during the load ends it with
 * a "lost the connection" failure; the page offers a reload.
 */
export function createSessionLoad(traceId: string, connect: () => Promise<LoadClient> = defaultClient) {
  const [state, setState] = createSignal<LoadState>({ status: 'loading', bytesRead: 0, totalBytes: 0 })
  let reader: { cancel: () => void } | undefined
  let attempt = 0
  /** Aborted by `onCleanup`: no state update or subscription may outlive the route. */
  const lifetime = new AbortController()
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
      if (mine !== attempt || lifetime.signal.aborted) {
        return
      }
      offStatus?.()
      offStatus = client.onStatus(status => {
        if (
          (status === 'disconnected' || status === 'error')
          && state().status === 'loading'
          && !lifetime.signal.aborted
        ) {
          fail(lostFailure())
        }
      })
      if (client.status === 'disconnected' || client.status === 'error') {
        return fail(lostFailure())
      }
      const started = await client.loadTrace(traceId)
      // After the check above, TypeScript narrows `lifetime.signal.aborted` to false and keeps that
      // across awaits, though `onCleanup` can abort during them: `throwIfAborted` reads the live value.
      if (mine !== attempt) {
        return
      }
      lifetime.signal.throwIfAborted()
      const stream = client.subscribe(LOAD_PROGRESS_CHANNEL, started.loadId)
      reader = stream
      setState({ status: 'loading', bytesRead: 0, totalBytes: started.totalBytes })
      void (async () => {
        for await (const chunk of stream) {
          if (mine !== attempt || lifetime.signal.aborted) {
            break
          }
          setState(current => (current.status === 'loading' ? { status: 'loading', ...chunk } : current))
        }
      })().catch(() => {
        // The stream ends with the load's error; `get-trace-view` reports it.
      })
      const view = await client.traceView(traceId)
      lifetime.signal.throwIfAborted()
      if (mine !== attempt || state().status === 'error') {
        return
      }
      const live = client
      setState({
        status: 'ready',
        session: { traceId, trace: view.trace, summary: view.summary, event: id => live.event(traceId, id) },
      })
    } catch (error) {
      if (mine !== attempt || lifetime.signal.aborted || isCancelled(error) || state().status === 'error') {
        return
      }
      if (client && (client.status === 'disconnected' || client.status === 'error')) {
        return fail(lostFailure())
      }
      fail(parseFailure(messageOf(error)))
    }
  }

  void run()

  onCleanup(() => {
    lifetime.abort()
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
    traceId: '',
    trace: report.trace,
    summary: report.summary,
    event: async id => {
      const found = full.get(id)
      if (found) {
        return found
      }
      const shown = view.get(id)
      if (!shown) {
        throw new Error(`unknown event ${id}`)
      }
      return { ...shown, notInReport: true }
    },
  }
}
