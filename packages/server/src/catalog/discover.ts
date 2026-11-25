import * as z from 'zod/mini'
import {
  isSessionHead,
  sessionAdapterHome,
  type SessionAdapter,
  type SessionHead,
  type SessionListError,
  type SessionRef,
} from '@rivus/agent-kit/sessions'
import type { ShellPlatform } from '../sessions/load-session.ts'
import { serverRedaction, type Redactor } from '../sessions/redaction.ts'
import { adapterDisplayName, keepsSessionsInDatabase } from '../sessions/adapters.ts'
import { errorMessage, listError } from '../sessions/read-failure.ts'
import { errorRow, rowFromHead, type LiveRow } from './rows.ts'

/** Parallel `stat` calls while building rows. */
const STAT_BATCH = 64

const errnoShape = z.object({ code: z.optional(z.string()) })

/** The errno code of a caught I/O error, when it carries one. */
function errnoOf(error: unknown): string | undefined {
  const parsed = z.safeParse(errnoShape, error)
  return parsed.success ? parsed.data.code : undefined
}

export interface AgentState {
  adapter: SessionAdapter
  /** Files whose head and tail were read. */
  read: number
  /** Files under the roots, once `discover` has listed them. */
  total?: number
  done: boolean
  found: string[]
  missing: string[]
  /**
   * Roots that could not be read at all, once each: the path, the failure's message, and its errno code. Only a
   * root whose `stat` fails or that the kit itself reports unreadable is here; a `discover` that fails halfway
   * keeps its error row and no more.
   */
  unreadable: { path: string; message: string; code: string | undefined }[]
}

/** An agent root the `discover` pass could not read at all: its sessions could not be read. */
export interface UnreadableRoot {
  /** The agent's id, as its rows carry it. */
  agent: string
  /** The product name the rail shows. */
  displayName: string
  /** The root, with `~` for the home directory. */
  path: string
  /** The failure, with `~` for the home directory. */
  reason: string
  /** The failure's errno code, when it carries one. */
  code: string | undefined
}

export interface AgentProgress {
  name: string
  read: number
  /** Known once the agent's roots have been listed. */
  total?: number
  done: boolean
  /** Set when no root exists: the paths that were checked, with `~`. */
  checked?: string
  /** Set once the agent is done and a root could not be read: those paths, once each, with `~`. */
  unreadable?: string
}

export function agentState(adapter: SessionAdapter): AgentState {
  return { adapter, read: 0, done: false, found: [], missing: [], unreadable: [] }
}

export function progressOf(states: readonly AgentState[], redact: Redactor): AgentProgress[] {
  return states.map(state => {
    const checked = state.done && state.found.length === 0 ? state.missing.map(redact).join(', ') : undefined
    const unreadable =
      state.done && state.unreadable.length > 0 ? state.unreadable.map(root => redact(root.path)).join(', ') : undefined
    return {
      name: adapterDisplayName(state.adapter),
      read: state.read,
      ...(state.total !== undefined ? { total: state.total } : {}),
      done: state.done,
      ...(checked ? { checked } : {}),
      ...(unreadable ? { unreadable } : {}),
    }
  })
}

/**
 * One `discover` pass over every agent: roots → head/tail reads → rows keyed by trace id.
 * Agents run side by side; each adapter's own `discover` stays sequential.
 * A missing root is recorded on the agent (S3). An unreadable file becomes an error row (S4), and so does
 * a root that cannot be read: it fails its agent only, never the pass. Every agent runs to its end before a
 * failure elsewhere ends the pass, so the roots that could not be read are all known by then.
 */
export async function discoverRows(
  states: readonly AgentState[],
  platform: ShellPlatform,
  report: () => void,
): Promise<Map<string, LiveRow>> {
  const rows = new Map<string, LiveRow>()
  const redact = serverRedaction(platform.home).text
  const add = (row: LiveRow) => {
    if (!rows.has(row.traceId)) {
      rows.set(row.traceId, row)
    }
  }
  const passes = await Promise.allSettled(
    states.map(async state => {
      const heads: SessionHead[] = []
      const failed: { target: SessionRef; error: SessionListError; mtimeMs?: number }[] = []
      const home = sessionAdapterHome(state.adapter, { env: platform.env, home: platform.home })
      /** Remembers a root the pass could not read, once, for the terminal: its reason and errno code. */
      const rootUnreadable = (root: string, message: string, code: string | undefined): void => {
        if (!state.unreadable.some(known => known.path === root)) {
          state.unreadable.push({ path: root, message, code })
        }
      }
      /** The "could not read" row of a root that a failure kept from being read at all. */
      const rootFailure = (root: string, message: string) => ({
        target: { agent: state.adapter.agent, path: root },
        error: { _tag: 'ReadFailed' as const, path: root, message },
      })
      for (const root of state.adapter.roots(home)) {
        let info: Awaited<ReturnType<ShellPlatform['fs']['stat']>>
        try {
          // Symlinks resolved: the session files' own stat is the cache key.
          info = await platform.fs.stat(root, { followSymlinks: true })
        } catch (error) {
          // The kit's `stat` returns `undefined` for a missing root and throws for one it cannot reach,
          // such as a `~/.claude` without search permission: that root is unreadable, and the pass goes on.
          const message = errorMessage(error)
          rootUnreadable(root, message, errnoOf(error))
          failed.push(rootFailure(root, message))
          continue
        }
        if (info === undefined || info.kind !== 'dir') {
          state.missing.push(root)
          continue
        }
        state.found.push(root)
        try {
          const onTotal = (files: number) => {
            state.total = (state.total ?? 0) + files
            report()
          }
          for await (const item of state.adapter.discover(platform, root, { onTotal })) {
            if (isSessionHead(item)) {
              heads.push(item)
              state.read += 1
              report()
              continue
            }
            // A `RootMissing` was recorded by the stat above.
            if (item.error._tag !== 'ReadFailed') {
              continue
            }
            const target = item.ref
            // The kit's own failure for the root: the folder exists but could not be listed.
            if (target.path === root) {
              rootUnreadable(root, item.error.message, errnoOf(item.error.cause))
            }
            // A directory failure keeps its error row but is not a file read: `read` counts
            // head-and-tail reads, and `total` lists files, so counting dirs shows 12/11.
            const probed = await platform.fs.stat(target.path, { followSymlinks: true })
            failed.push({
              target,
              error: item.error,
              ...(probed?.mtimeMs !== undefined ? { mtimeMs: probed.mtimeMs } : {}),
            })
            if (probed?.kind !== 'dir') {
              state.read += 1
              report()
            }
          }
        } catch (error) {
          // Sessions read before the failure are kept, so the root is not recorded as unreadable.
          failed.push(rootFailure(root, errorMessage(error)))
        }
      }
      const perFile = new Map<string, number>()
      for (const head of heads) {
        perFile.set(head.ref.path, (perFile.get(head.ref.path) ?? 0) + 1)
      }
      // All sessions in a database share one stat of its file in this pass.
      const stats = new Map<string, ReturnType<ShellPlatform['fs']['stat']>>()
      const statFile = (path: string) => {
        let pending = stats.get(path)
        if (!pending) {
          pending = platform.fs.stat(path, { followSymlinks: true })
          stats.set(path, pending)
        }
        return pending
      }
      // `discover` reports no mtime, and the cache key needs one.
      for (let start = 0; start < heads.length; start += STAT_BATCH) {
        const batch = heads.slice(start, start + STAT_BATCH)
        const infos = await Promise.all(batch.map(head => statFile(head.ref.path)))
        batch.forEach((head, index) => {
          const info = infos[index]
          const target = head.ref
          if (info !== undefined && info.kind === 'file') {
            // Every session in one database shares the file stamp, and another session's write changes it.
            // This session's own last write moves with every write to it, so that alone is its cache key;
            // the shared size says nothing about this row and would invalidate all of them.
            const key = keepsSessionsInDatabase(state.adapter.agent)
              ? { size: 0, mtimeMs: head.lastActiveAt }
              : undefined
            add(rowFromHead(target, head, info, redact, (perFile.get(head.ref.path) ?? 0) > 1, key))
          } else {
            add(errorRow(target, { reason: 'session file does not exist', file: redact(target.path) }, Date.now()))
          }
        })
      }
      // An unreadable file sorts by its own mtime, not 1970.
      failed.forEach(item => {
        add(errorRow(item.target, listError(item.error, redact), item.mtimeMs ?? Date.now()))
      })
      state.done = true
      report()
    }),
  )
  const failed = passes.find((pass): pass is PromiseRejectedResult => pass.status === 'rejected')
  if (failed) {
    throw failed.reason
  }
  return rows
}
