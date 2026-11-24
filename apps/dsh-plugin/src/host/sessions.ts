import type { FileStamp, ResolvedSession, TraceStore } from '@rivus/estela-rpc/trace-store'
import { traceIdOf, type EstelaCore } from '@rivus/estela-server/core'
import * as z from 'zod/mini'
import type { ChannelErrorCode } from '../contract/channel.ts'
import type { HostSessionPersistence, RpcFailureResult } from './rpc.ts'

/** Maximum number of recently issued trace ids retained by the host (exceeds TraceStore's 3-slot cache). */
const MAX_ISSUED_IDS = 16

export const FIXED_FAILURE_MESSAGE = 'the session could not be read'
export const STALE_MESSAGE = 'the session log changed since it was opened'

const formatUnsupportedErrorSchema = z.object({
  name: z.literal('SessionFormatUnsupportedError'),
  message: z.string(),
  location: z.optional(z.object({ path: z.string() })),
})

export interface IssuedSession extends ResolvedSession {
  readonly expect: FileStamp
}

type OpenSessionOutcome =
  | { readonly ok: true; readonly traceId: string }
  | { readonly ok: false; readonly result: RpcFailureResult }

type ReadySessionOutcome =
  | { readonly ok: true; readonly session: IssuedSession }
  | { readonly ok: false; readonly result: RpcFailureResult }

type StatOutcome =
  | { readonly kind: 'ok'; readonly stamp: FileStamp }
  | { readonly kind: 'missing' }
  | { readonly kind: 'error' }

interface SessionRegistryDeps {
  readonly persistence: HostSessionPersistence
  readonly fs: EstelaCore['platform']['fs']
  readonly store: TraceStore
  readonly redact: EstelaCore['redact']
}

export interface SessionRegistry {
  open: (sessionId: string, signal?: AbortSignal) => Promise<OpenSessionOutcome>
  checkReady: (traceId: string) => Promise<ReadySessionOutcome>
  /**
   * Called when `store.event` returns `originalUnavailable`: invalidates `traceId` with
   * `estela/stale` if the source file changed or no longer exists, and preserves the unavailable
   * result when the file is still unchanged at the same stamp.
   */
  checkUnavailableEvent: (traceId: string, session: IssuedSession) => Promise<RpcFailureResult | undefined>
  invalidate: (traceId: string) => void
  resolve: (traceId: string) => ResolvedSession | undefined
  /** Keeps an in-flight load resolvable if concurrent opens push its id past the 16-id window. */
  pin: (traceId: string, session: IssuedSession) => () => void
  /** Clears issued and pinned entries and prevents in-flight opens from re-populating the registry. */
  close: () => void
}

function refusal(code: ChannelErrorCode, message: string): RpcFailureResult {
  return { ok: false, error: { code, message, details: {} } }
}

/**
 * Formats dsh's `SessionFormatUnsupportedError` into the kit's `agent: <path>:1: unknown format
 * generation: <reason>` shape with both path and reason passed through `redact`.
 */
function formatUnsupportedMessage(
  error: z.output<typeof formatUnsupportedErrorSchema>,
  redact: EstelaCore['redact'],
): string {
  const rawLogMatch = / \(raw log: (.+)\)$/.exec(error.message)
  const rawPath = error.location?.path || rawLogMatch?.[1] || 'session'
  const suffix = ` (raw log: ${rawPath})`
  const stripped = error.message.endsWith(suffix) ? error.message.slice(0, -suffix.length) : error.message
  const reason = stripped.trim() || error.message.trim() || 'unsupported session format'
  return `dsh: ${redact(rawPath)}:1: unknown format generation: ${redact(reason)}`
}

async function statFile(fs: EstelaCore['platform']['fs'], path: string): Promise<StatOutcome> {
  try {
    const info = await fs.stat(path, { followSymlinks: true })
    if (!info) {
      return { kind: 'missing' }
    }
    return { kind: 'ok', stamp: { size: info.size, mtimeMs: info.mtimeMs } }
  } catch {
    return { kind: 'error' }
  }
}

/**
 * Maps dsh session ids to opaque trace ids keyed by log path, size, and mtime, keeps the 16 most
 * recently issued ids, and attaches each id's expected stamp for TraceStore's cache invariant.
 */
function isStaleStat(current: Exclude<StatOutcome, { readonly kind: 'error' }>, expect: FileStamp): boolean {
  return current.kind === 'missing' || current.stamp.size !== expect.size || current.stamp.mtimeMs !== expect.mtimeMs
}

export function createSessionRegistry(deps: SessionRegistryDeps): SessionRegistry {
  let closed = false
  const issued = new Map<string, IssuedSession>()
  const pinned = new Map<string, { session: IssuedSession; count: number }>()

  function isClosed(): boolean {
    return closed
  }

  function remember(traceId: string, entry: IssuedSession): void {
    if (closed) {
      return
    }
    issued.delete(traceId)
    issued.set(traceId, entry)
    while (issued.size > MAX_ISSUED_IDS) {
      const oldest = issued.keys().next().value
      if (oldest === undefined) {
        break
      }
      issued.delete(oldest)
    }
  }

  return {
    async open(sessionId, signal) {
      if (isClosed()) {
        return { ok: false, result: refusal('estela/closed', 'the plugin is closed') }
      }
      let snapshot
      try {
        snapshot = await deps.persistence.stat(sessionId, signal ? { signal } : undefined)
      } catch (error) {
        if (isClosed()) {
          return { ok: false, result: refusal('estela/closed', 'the plugin is closed') }
        }
        const unsupported = z.safeParse(formatUnsupportedErrorSchema, error)
        if (unsupported.success) {
          return {
            ok: false,
            result: refusal('estela/failed', formatUnsupportedMessage(unsupported.data, deps.redact)),
          }
        }
        return { ok: false, result: refusal('estela/failed', FIXED_FAILURE_MESSAGE) }
      }

      if (isClosed()) {
        return { ok: false, result: refusal('estela/closed', 'the plugin is closed') }
      }
      if (!snapshot) {
        return { ok: false, result: refusal('estela/unknown-session', 'unknown session') }
      }
      const path = snapshot.location?.path
      if (!path) {
        return { ok: false, result: refusal('estela/no-log', 'this session has no log on disk yet') }
      }

      const info = await statFile(deps.fs, path)
      if (isClosed()) {
        return { ok: false, result: refusal('estela/closed', 'the plugin is closed') }
      }
      if (info.kind !== 'ok') {
        return { ok: false, result: refusal('estela/failed', FIXED_FAILURE_MESSAGE) }
      }
      if (signal?.aborted) {
        return { ok: false, result: refusal('estela/failed', FIXED_FAILURE_MESSAGE) }
      }

      const traceId = traceIdOf({ agent: 'dsh', path, sessionId: `${info.stamp.size}:${info.stamp.mtimeMs}` })
      remember(traceId, { key: traceId, target: { path }, expect: info.stamp })
      return { ok: true, traceId }
    },

    async checkReady(traceId) {
      const entry = issued.get(traceId)
      if (!entry) {
        return { ok: false, result: refusal('estela/unknown-trace', 'unknown trace') }
      }
      if (deps.store.cachedKeys().includes(entry.key)) {
        return { ok: true, session: entry }
      }
      const current = await statFile(deps.fs, entry.target.path)
      if (current.kind === 'error') {
        return { ok: false, result: refusal('estela/failed', FIXED_FAILURE_MESSAGE) }
      }
      if (isStaleStat(current, entry.expect)) {
        issued.delete(traceId)
        return { ok: false, result: refusal('estela/stale', STALE_MESSAGE) }
      }
      return { ok: true, session: entry }
    },

    async checkUnavailableEvent(traceId, session) {
      const current = await statFile(deps.fs, session.target.path)
      if (current.kind === 'error') {
        return undefined
      }
      if (isStaleStat(current, session.expect)) {
        issued.delete(traceId)
        return refusal('estela/stale', STALE_MESSAGE)
      }
      return undefined
    },

    invalidate(traceId) {
      issued.delete(traceId)
    },

    resolve(traceId) {
      return issued.get(traceId) ?? pinned.get(traceId)?.session
    },

    pin(traceId, session) {
      if (closed) {
        return () => {}
      }
      const existing = pinned.get(traceId)
      if (existing) {
        existing.count += 1
      } else {
        pinned.set(traceId, { session, count: 1 })
      }
      let released = false
      return () => {
        if (released) {
          return
        }
        released = true
        const current = pinned.get(traceId)
        if (!current) {
          return
        }
        current.count -= 1
        if (current.count <= 0) {
          pinned.delete(traceId)
        }
      }
    },

    close() {
      closed = true
      issued.clear()
      pinned.clear()
    },
  }
}
