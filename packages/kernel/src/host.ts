import type { Capability, Trace } from '@rivus/agent-trace-schema'
import type { HostEnv, TraceIO } from './io.ts'

export type { Capability } from '@rivus/agent-trace-schema'

export interface SessionRef {
  host: string
  path: string
  sessionId?: string
}

export interface SessionHead {
  ref: SessionRef
  title?: string
  cwd?: string
  startedAt?: number
  lastActiveAt: number
  sizeBytes: number
  firstPrompt?: string
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

export interface DiscoverOptions {
  signal?: AbortSignal
  /** Called once with the number of files under the root, before their heads are read (progress). */
  onTotal?: (files: number) => void
}

export interface LoadOptions {
  signal?: AbortSignal
  onProgress?: (bytes: number) => void
}

export interface HostAdapter {
  id: string
  displayName: string
  capabilities: readonly Capability[]
  /** Default locations for this host, for example `<home>/.claude/projects`. */
  roots: (env: HostEnv) => string[]
  /** Cheap: list files and read at most 64 KB from each end. */
  discover: (root: string, io: TraceIO, opts: DiscoverOptions) => AsyncIterable<SessionHead | { ref: SessionRef, error: string }>
  detect: (ref: SessionRef, io: TraceIO) => Promise<boolean>
  load: (ref: SessionRef, io: TraceIO, opts: { signal?: AbortSignal, onProgress?: (bytes: number) => void }) => Promise<Trace>
  /** Defaults to `fold(await load(...))`; a host may override it with a faster pass. */
  summarize?: (ref: SessionRef, io: TraceIO, opts: { signal?: AbortSignal }) => Promise<SessionSummary>
}
