import type { SessionSummary } from '@rivus/agent-kit/transcript'

export interface ListSessionsQuery {
  /** Searched in the session index (titles and user prompts), not in the browser. */
  query?: string
  /** Return only rows that changed after this revision. Omit for every row. */
  since?: number
  /** Trace ids of the rows to summarize before the rest, for example the rows on screen. Concurrency stays at 4. */
  first?: string[]
}

export interface AgentListEntry {
  id: string
  displayName: string
  count: number
  /** Set when the agent has no sessions: the root that was checked, with `~` for the home directory. */
  checked?: string
}

export interface SessionError {
  reason: string
  line?: number
  /** File with `~` for the home directory. */
  file?: string
}

/**
 * Head fields, then summary numbers. A number is `undefined` until a summary exists or when the agent
 * does not record it. `contextShape` is sent as `shape`: the same points scaled to 0–100 of the
 * session's largest request, which is all the preview draws and a third of the bytes.
 */
export interface SessionListRow extends Omit<SessionSummary, 'contextShape'> {
  /** Input tokens per request, scaled to 0–100 (integers). */
  shape?: number[]
  /** Opaque id (hash of agent and path) the browser opens the session by. The server maps it back to a file. */
  traceId: string
  agent: string
  title?: string
  project?: string
  /** Working directory with `~` for the home directory. */
  cwd?: string
  startedAt?: number
  lastActiveAt: number
  sizeBytes: number
  firstPrompt?: string
  /**
   * List price of the session's priced requests at `ListSessionsResult.pricesVersion`; absent when none is priced or
   * the summary is not done. Never 0 for "unknown".
   */
  costUsd?: number
  /** Requests the cost leaves out (no usage, no model, or no price); absent when the reader gives none to price. */
  unpricedRequests?: number
  /** A summary is still being computed. */
  pending: boolean
  /** "Could not read": discover or summarize failed. */
  error?: SessionError
}

export interface ListSessionsResult {
  agents: AgentListEntry[]
  /** Every row without `since`; otherwise only rows changed after `since`. */
  rows: SessionListRow[]
  /** `rows` is the full list, so the client replaces instead of merging. */
  complete: boolean
  /** With `since`: trace ids of the rows removed after `since` (the file is gone). */
  removed?: string[]
  /** With `query`: trace ids of the matching rows, from the index. */
  matches?: string[]
  /** Rows whose summary is not done yet. */
  pending: number
  /** Increases whenever a row changes. Pass it back as `since`. */
  revision: number
  /** The price snapshot every row's `costUsd` is priced at. */
  pricesVersion: string
}

/** Shared state pushed to every browser. It only says that rows changed; the rows come from `list-sessions`. */
export interface SessionsSignal {
  revision: number
  pending: number
}

export const SESSIONS_STATE = 'sessions'

export function emptySessionsSignal(): SessionsSignal {
  return { revision: 0, pending: 0 }
}
