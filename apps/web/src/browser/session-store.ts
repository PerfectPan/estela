import type {
  AgentListEntry,
  ListSessionsQuery,
  ListSessionsResult,
  SessionListRow,
  SessionsSignal,
} from '@rivus/agent-trace-rpc'
import { batch, createSignal, onCleanup } from 'solid-js'
import { scopedClient } from '@/shell/client.ts'

/** Must match `SESSIONS_STATE` in `@rivus/agent-trace-rpc` (the web app imports only its types). */
const SESSIONS_STATE = 'sessions'

async function listSessions(query: ListSessionsQuery): Promise<ListSessionsResult> {
  const ctx = await scopedClient()
  return ctx.rpc.call('list-sessions', query)
}

/**
 * Rows from `list-sessions`, kept current by push: the server's shared state carries only
 * `{ revision, pending }`, and each change asks for the rows changed since the last revision.
 * A row that did not change keeps its object, so the list re-renders only changed rows.
 */
export function createSessionStore() {
  const [agents, setAgents] = createSignal<AgentListEntry[]>([])
  const [rows, setRows] = createSignal<SessionListRow[]>([])
  const [pending, setPending] = createSignal(0)
  const [loaded, setLoaded] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [matches, setMatches] = createSignal<ReadonlySet<string>>()
  let revision: number | undefined
  let inflight = false
  let again = false
  let wanted: string[] = []
  let query = ''
  let searchSeq = 0
  /** Aborted by `onCleanup`: a settled request must not apply rows after the store is gone. */
  const lifetime = new AbortController()
  const cleanups: (() => void)[] = []

  function fail(reason: unknown): void {
    setError(reason instanceof Error ? reason.message : String(reason))
  }

  function apply(result: ListSessionsResult): void {
    batch(() => {
      setAgents(result.agents)
      setPending(result.pending)
      if (result.complete) {
        setRows(result.rows)
      } else if (result.rows.length > 0 || (result.removed?.length ?? 0) > 0) {
        const changed = new Map(result.rows.map(row => [row.traceId, row]))
        const gone = new Set(result.removed ?? [])
        const next = rows()
          .filter(row => !gone.has(row.traceId))
          .map(row => changed.get(row.traceId) ?? row)
        const known = new Set(next.map(row => row.traceId))
        for (const row of result.rows) {
          if (!known.has(row.traceId)) {
            next.push(row)
          }
        }
        next.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        setRows(next)
      }
      setError(undefined)
      setLoaded(true)
    })
    revision = Math.max(revision ?? 0, result.revision)
  }

  async function runSearch(): Promise<void> {
    const seq = ++searchSeq
    const text = query
    try {
      const result = await listSessions(revision === undefined ? { query: text } : { query: text, since: revision })
      if (seq !== searchSeq || lifetime.signal.aborted || text !== query) {
        return
      }
      apply(result)
      setMatches(new Set(result.matches ?? []))
    } catch (reason) {
      fail(reason)
    }
  }

  async function refresh(): Promise<void> {
    if (inflight) {
      again = true
      return
    }
    inflight = true
    const before = revision
    try {
      const first = wanted
      wanted = []
      const request: ListSessionsQuery = revision === undefined ? {} : { since: revision }
      if (first.length > 0) {
        request.first = first
      }
      const result = await listSessions(request)
      if (!lifetime.signal.aborted) {
        apply(result)
      }
      // New titles and prompts may match the active search.
      if (query && revision !== before) {
        void runSearch()
      }
    } catch (reason) {
      fail(reason)
    } finally {
      inflight = false
      if (again && !lifetime.signal.aborted) {
        again = false
        void refresh()
      }
    }
  }

  /** Ask the server to summarize the rows with these trace ids (the rows on screen) before the rest. */
  function prioritize(traceIds: string[]): void {
    wanted = traceIds
    void refresh()
  }

  /** Search runs in the server's index and is re-run when rows change. An empty query clears it. */
  function search(text: string): Promise<void> {
    query = text.trim()
    if (!query) {
      searchSeq += 1
      setMatches(undefined)
      return Promise.resolve()
    }
    return runSearch()
  }

  void refresh()
  void (async () => {
    try {
      const ctx = await scopedClient()
      const state = await ctx.rpc.sharedState<SessionsSignal>(SESSIONS_STATE, {
        initialValue: { revision: 0, pending: 0 },
      })
      const changed = (signal: SessionsSignal) => {
        if (revision === undefined || signal.revision > revision) {
          void refresh()
        }
      }
      const off = state.on('updated', changed)
      // A change between the first response and the subscription would otherwise be missed.
      changed(state.value())
      if (lifetime.signal.aborted) {
        off()
      } else {
        cleanups.push(off)
      }
    } catch {
      // Without push the pending poll still fills the rows in.
    }
  })()

  onCleanup(() => {
    lifetime.abort()
    for (const fn of cleanups.splice(0)) {
      fn()
    }
  })

  return { agents, rows, pending, loaded, error, matches, search, prioritize, refresh }
}
