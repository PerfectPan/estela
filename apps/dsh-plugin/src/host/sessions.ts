import type { ResolvedSession, TraceStore } from '@rivus/estela-rpc/trace-store'
import { traceIdOf, type EstelaCore } from '@rivus/estela-server/core'
import * as z from 'zod/mini'
import type { ChannelErrorCode } from '../contract/channel.ts'
import type { HostSessionPersistence, RpcHandlerResult } from './rpc.ts'

/** Maximum number of recently issued trace ids retained by the host (exceeds TraceStore's 3-slot cache). */
const MAX_ISSUED_IDS = 16

export const FIXED_FAILURE_MESSAGE = 'the session could not be read'

const formatUnsupportedErrorSchema = z.object({
  name: z.literal('SessionFormatUnsupportedError'),
  message: z.string(),
  location: z.optional(z.object({ path: z.string() })),
})

interface FileStamp {
  readonly size: number
  readonly mtimeMs: number
}

interface IssuedSession extends ResolvedSession {
  readonly stamp: FileStamp
}

type OpenSessionOutcome =
  | { readonly ok: true; readonly traceId: string }
  | { readonly ok: false; readonly result: RpcHandlerResult }

type ReadySessionOutcome =
  | { readonly ok: true; readonly session: IssuedSession }
  | { readonly ok: false; readonly result: RpcHandlerResult }

export interface SessionRegistryDeps {
  readonly persistence: HostSessionPersistence
  readonly fs: EstelaCore['platform']['fs']
  readonly store: TraceStore
  readonly redact: EstelaCore['redact']
}

export interface SessionRegistry {
  open: (sessionId: string, signal?: AbortSignal) => Promise<OpenSessionOutcome>
  checkReady: (traceId: string) => Promise<ReadySessionOutcome>
  resolve: (traceId: string) => ResolvedSession | undefined
  /** Keeps an in-flight load resolvable if concurrent opens push its id past the 16-id window. */
  pin: (traceId: string, session: IssuedSession) => () => void
  clear: () => void
}

function refusal(code: ChannelErrorCode, message: string): RpcHandlerResult {
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

async function safeStat(fs: EstelaCore['platform']['fs'], path: string): Promise<FileStamp | undefined> {
  try {
    const info = await fs.stat(path, { followSymlinks: true })
    if (!info) {
      return undefined
    }
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return undefined
  }
}

/**
 * Maps dsh session ids to opaque trace ids keyed by log path, size, and mtime, keeps the 16 most
 * recently issued ids, and refuses evicted snapshots whose log changed on disk before re-reading.
 */
export function createSessionRegistry(deps: SessionRegistryDeps): SessionRegistry {
  const issued = new Map<string, IssuedSession>()
  const pinned = new Map<string, { session: IssuedSession; count: number }>()

  function remember(traceId: string, entry: IssuedSession): void {
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
      let snapshot
      try {
        snapshot = await deps.persistence.stat(sessionId, signal ? { signal } : undefined)
      } catch (error) {
        const unsupported = z.safeParse(formatUnsupportedErrorSchema, error)
        if (unsupported.success) {
          return {
            ok: false,
            result: refusal('estela/failed', formatUnsupportedMessage(unsupported.data, deps.redact)),
          }
        }
        return { ok: false, result: refusal('estela/failed', FIXED_FAILURE_MESSAGE) }
      }

      if (!snapshot) {
        return { ok: false, result: refusal('estela/unknown-session', 'unknown session') }
      }
      const path = snapshot.location?.path
      if (!path) {
        return { ok: false, result: refusal('estela/no-log', 'this session has no log on disk yet') }
      }

      const info = await safeStat(deps.fs, path)
      if (!info) {
        return { ok: false, result: refusal('estela/failed', FIXED_FAILURE_MESSAGE) }
      }

      const traceId = traceIdOf({ agent: 'dsh', path, sessionId: `${info.size}:${info.mtimeMs}` })
      remember(traceId, { key: traceId, target: { path }, stamp: info })
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
      const current = await safeStat(deps.fs, entry.target.path)
      if (!current) {
        return { ok: false, result: refusal('estela/failed', FIXED_FAILURE_MESSAGE) }
      }
      if (current.size !== entry.stamp.size || current.mtimeMs !== entry.stamp.mtimeMs) {
        issued.delete(traceId)
        return { ok: false, result: refusal('estela/stale', 'the session log changed since it was opened') }
      }
      return { ok: true, session: entry }
    },

    resolve(traceId) {
      return issued.get(traceId) ?? pinned.get(traceId)?.session
    },

    pin(traceId, session) {
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

    clear() {
      issued.clear()
      pinned.clear()
    },
  }
}
