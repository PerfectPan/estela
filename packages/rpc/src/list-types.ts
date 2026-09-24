import type { SessionSummary } from '@rivus/agent-trace-kernel'

export interface ListSessionsQuery {
  /** Searched in the session index (titles and user prompts), not in the browser. */
  query?: string
  /** Return only rows that changed after this revision. Omit for every row. */
  since?: number
  /** Refs to summarize before the rest, for example the rows on screen. Concurrency stays at 4. */
  first?: string[]
}

export interface HostListEntry {
  id: string
  displayName: string
  count: number
  /** Set when the host has no sessions: the root that was checked, with `~` for the home directory. */
  checked?: string
}

export interface SessionError {
  reason: string
  line?: number
  /** File with `~` for the home directory. */
  file?: string
}

/**
 * Head fields, then summary numbers. A number is `undefined` until a summary exists or when the host
 * does not record it. `contextShape` is sent as `shape`: the same points scaled to 0–100 of the
 * session's largest request, which is all the preview draws and a third of the bytes.
 */
export interface SessionListRow extends Omit<SessionSummary, 'contextShape'> {
  /** Input tokens per request, scaled to 0–100 (integers). */
  shape?: number[]
  /** Opaque id (hash of host and path). The server maps it back to a file. */
  ref: string
  host: string
  title?: string
  project?: string
  /** Working directory with `~` for the home directory. */
  cwd?: string
  startedAt?: number
  lastActiveAt: number
  sizeBytes: number
  firstPrompt?: string
  /** A summary is still being computed. */
  pending: boolean
  /** "Could not read": discover or summarize failed. */
  error?: SessionError
}

export interface ListSessionsResult {
  hosts: HostListEntry[]
  /** Every row without `since`; otherwise only rows changed after `since`. */
  rows: SessionListRow[]
  /** `rows` is the full list, so the client replaces instead of merging. */
  complete: boolean
  /** With `since`: refs removed after `since` (the file is gone). */
  removed?: string[]
  /** With `query`: matching refs from the index. */
  matches?: string[]
  /** Rows whose summary is not done yet. */
  pending: number
  /** Increases whenever a row changes. Pass it back as `since`. */
  revision: number
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
