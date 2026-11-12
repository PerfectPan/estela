import {
  isSessionHead,
  sessionAdapterHome,
  type SessionAdapter,
  type SessionHead,
  type SessionListError,
  type SessionRef,
} from '@rivus/agent-kit/sessions'
import { redactText } from '@rivus/agent-kit/redact'
import { errorRow, rowFromHead, type CatalogPlatform, type LiveRow } from './catalog-rows.ts'
import { adapterDisplayName } from './session-adapters.ts'
import { errorMessage, listError } from './read-failure.ts'

/** Parallel `stat` calls while building rows. */
const STAT_BATCH = 64

export interface AgentState {
  adapter: SessionAdapter
  /** Files whose head and tail were read. */
  read: number
  /** Files under the roots, once `discover` has listed them. */
  total?: number
  done: boolean
  found: string[]
  missing: string[]
}

export interface AgentProgress {
  name: string
  read: number
  /** Known once the agent's roots have been listed. */
  total?: number
  done: boolean
  /** Set when no root exists: the paths that were checked, with `~`. */
  checked?: string
}

export function agentState(adapter: SessionAdapter): AgentState {
  return { adapter, read: 0, done: false, found: [], missing: [] }
}

export function progressOf(states: readonly AgentState[], homeDir: string): AgentProgress[] {
  return states.map(state => {
    const checked =
      state.done && state.found.length === 0
        ? state.missing.map(path => redactText(path, { home: homeDir })).join(', ')
        : undefined
    return {
      name: adapterDisplayName(state.adapter),
      read: state.read,
      ...(state.total !== undefined ? { total: state.total } : {}),
      done: state.done,
      ...(checked ? { checked } : {}),
    }
  })
}

/**
 * One `discover` pass over every agent: roots → head/tail reads → rows keyed by trace id.
 * Agents run side by side; each adapter's own `discover` stays sequential.
 * A missing root is recorded on the agent (S3). An unreadable file becomes an error row (S4).
 */
export async function discoverRows(
  states: readonly AgentState[],
  platform: CatalogPlatform,
  report: () => void,
): Promise<Map<string, LiveRow>> {
  const rows = new Map<string, LiveRow>()
  const add = (row: LiveRow) => {
    if (!rows.has(row.traceId)) {
      rows.set(row.traceId, row)
    }
  }
  await Promise.all(
    states.map(async state => {
      const heads: SessionHead[] = []
      const failed: { target: SessionRef; error: SessionListError; mtimeMs?: number }[] = []
      const home = sessionAdapterHome(state.adapter, { env: platform.env, home: platform.home })
      for (const root of state.adapter.roots(home)) {
        // Symlinks resolved: the session files' own stat is the cache key.
        const info = await platform.fs.stat(root, { followSymlinks: true })
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
          failed.push({
            target: { agent: state.adapter.agent, path: root },
            error: { _tag: 'ReadFailed', path: root, message: errorMessage(error) },
          })
        }
      }
      const perFile = new Map<string, number>()
      for (const head of heads) {
        perFile.set(head.ref.path, (perFile.get(head.ref.path) ?? 0) + 1)
      }
      // All sessions in a database share one snapshot of its main file and WAL in this pass.
      const stats = new Map<string, ReturnType<CatalogPlatform['fs']['stat']>>()
      const statFile = (path: string) => {
        let pending = stats.get(path)
        if (!pending) {
          pending = (async () => {
            const info = await platform.fs.stat(path, { followSymlinks: true })
            if (info?.kind !== 'file' || state.adapter.agent !== 'opencode') {
              return info
            }
            // Committed SQLite changes may still live in WAL without touching the main database.
            const wal = await platform.fs.stat(`${path}-wal`, { followSymlinks: true })
            return { ...info, size: info.size + (wal?.size ?? 0), mtimeMs: Math.max(info.mtimeMs, wal?.mtimeMs ?? 0) }
          })()
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
            // Every session in one OpenCode database shares the file stamp, and another session's write
            // changes it. This session's own last write is what changes its summary, so that alone is its
            // cache key; the shared size says nothing about this row and would invalidate all of them.
            const key = state.adapter.agent === 'opencode' ? { size: 0, mtimeMs: head.lastActiveAt } : undefined
            add(rowFromHead(target, head, info, platform.home, (perFile.get(head.ref.path) ?? 0) > 1, key))
          } else {
            add(
              errorRow(
                target,
                { reason: 'session file does not exist', file: redactText(target.path, { home: platform.home }) },
                Date.now(),
              ),
            )
          }
        })
      }
      // An unreadable file sorts by its own mtime, not 1970.
      failed.forEach(item => {
        add(errorRow(item.target, listError(item.error, platform.home), item.mtimeMs ?? Date.now()))
      })
      state.done = true
      report()
    }),
  )
  return rows
}
