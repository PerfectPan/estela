import type { HostListEntry, ListSessionsQuery, ListSessionsResult, SessionListRow, SessionsSignal } from '@rivus/agent-trace-rpc'
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
 */
export function createSessionStore() {
  const [hosts, setHosts] = createSignal<HostListEntry[]>([])
  const [rows, setRows] = createSignal<SessionListRow[]>([])
  const [pending, setPending] = createSignal(0)
  const [loaded, setLoaded] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [matches, setMatches] = createSignal<ReadonlySet<string>>()
  let revision: number | undefined
  let inflight = false
  let again = false
  let wanted: string[] = []
  let searchSeq = 0
  let disposed = false
  const cleanups: (() => void)[] = []

  function apply(result: ListSessionsResult): void {
    batch(() => {
      setHosts(result.hosts)
      setPending(result.pending)
      if (result.complete) {
        setRows(result.rows)
      }
      else if (result.rows.length > 0 || (result.removed?.length ?? 0) > 0) {
        const changed = new Map(result.rows.map(row => [row.ref, row]))
        const gone = new Set(result.removed ?? [])
        const next = rows().filter(row => !gone.has(row.ref)).map(row => changed.get(row.ref) ?? row)
        const known = new Set(next.map(row => row.ref))
        for (const row of result.rows) {
          if (!known.has(row.ref))
            next.push(row)
        }
        next.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        setRows(next)
      }
      setError(undefined)
      setLoaded(true)
    })
    revision = result.revision
  }

  async function refresh(): Promise<void> {
    if (inflight) {
      again = true
      return
    }
    inflight = true
    try {
      const first = wanted
      wanted = []
      const query: ListSessionsQuery = revision === undefined ? {} : { since: revision }
      if (first.length > 0)
        query.first = first
      const result = await listSessions(query)
      if (!disposed)
        apply(result)
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
    finally {
      inflight = false
      if (again && !disposed) {
        again = false
        void refresh()
      }
    }
  }

  /** Ask the server to summarize these refs (the rows on screen) before the rest. */
  function prioritize(refs: string[]): void {
    if (refs.length === 0)
      return
    wanted = refs
    void refresh()
  }

  /** Search runs in the server's index. An empty query clears the filter. */
  async function search(text: string): Promise<void> {
    const query = text.trim()
    const seq = ++searchSeq
    if (!query) {
      setMatches(undefined)
      return
    }
    try {
      const result = await listSessions(revision === undefined ? { query } : { query, since: revision })
      if (seq !== searchSeq || disposed)
        return
      apply(result)
      setMatches(new Set(result.matches ?? []))
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  void refresh()
  void (async () => {
    try {
      const ctx = await scopedClient()
      const state = await ctx.rpc.sharedState<SessionsSignal>(SESSIONS_STATE, { initialValue: { revision: 0, pending: 0 } })
      const off = state.on('updated', (signal) => {
        if (revision === undefined || signal.revision > revision)
          void refresh()
      })
      if (disposed)
        off()
      else
        cleanups.push(off)
    }
    catch {
      // Without push the list still shows the first response.
    }
  })()

  onCleanup(() => {
    disposed = true
    for (const fn of cleanups.splice(0))
      fn()
  })

  return { hosts, rows, pending, loaded, error, matches, search, prioritize }
}

export type SessionStore = ReturnType<typeof createSessionStore>
