/**
 * The session-level types the rpc contracts, the web app, and the session index are typed on.
 * They stay defined here because those packages cannot import `@rivus/agent-kit`, which owns
 * the summary semantics: keep the fields in lockstep with the kit's `SessionRef` and
 * `SessionSummary` (same names, same "absent, never 0" rule).
 */
export interface SessionRef {
  host: string
  path: string
  sessionId?: string
}

export interface SessionSummary {
  turns?: number
  requests?: number
  tokensIn?: number
  tokensOut?: number
  durationMs?: number
  compactions?: number
  subagents?: number
  failedTools?: number
  /** Input tokens per request in order, downsampled to at most 120 points. */
  contextShape?: number[]
}
