import type { SessionRef } from '@rivus/agent-trace-kernel'
import {
  isSessionHead,
  sessionAdapterHome,
  type SessionAdapter,
  type SessionHead,
  type SessionListError,
  type SessionRef as KitSessionRef,
} from '@rivus/agent-kit/sessions'
import { redactText } from '@rivus/agent-kit/redact'
import { errorRow, rowFromHead, type CatalogPlatform, type LiveRow } from './catalog-rows.ts'
import { errorMessage, listError } from './read-failure.ts'

/** Parallel `stat` calls while building rows. */
const STAT_BATCH = 64

export interface HostState {
  adapter: SessionAdapter
  /** Files whose head and tail were read. */
  read: number
  /** Files under the roots, once `discover` has listed them. */
  total?: number
  done: boolean
  found: string[]
  missing: string[]
}

export interface HostProgress {
  name: string
  read: number
  /** Known once the host has listed its files. */
  total?: number
  done: boolean
  /** Set when no root exists: the paths that were checked, with `~`. */
  checked?: string
}

export function hostState(adapter: SessionAdapter): HostState {
  return { adapter, read: 0, done: false, found: [], missing: [] }
}

export function progressOf(states: readonly HostState[], homeDir: string): HostProgress[] {
  return states.map(state => {
    const checked =
      state.done && state.found.length === 0
        ? state.missing.map(path => redactText(path, { home: homeDir })).join(', ')
        : undefined
    return {
      name: state.adapter.displayName,
      read: state.read,
      ...(state.total !== undefined ? { total: state.total } : {}),
      done: state.done,
      ...(checked ? { checked } : {}),
    }
  })
}

/** The kit ref of a head or failure, in the row/target shape (`ref.agent` reads as `host`). */
function kitRef(ref: KitSessionRef): SessionRef {
  return { host: ref.agent, path: ref.path, ...(ref.sessionId ? { sessionId: ref.sessionId } : {}) }
}

/**
 * One `discover` pass over every host: roots → head/tail reads → rows keyed by ref.
 * Hosts run side by side; each adapter's own `discover` stays sequential.
 * A missing root is recorded on the host (S3). An unreadable file becomes an error row (S4).
 */
export async function discoverRows(
  states: readonly HostState[],
  platform: CatalogPlatform,
  report: () => void,
): Promise<Map<string, LiveRow>> {
  const rows = new Map<string, LiveRow>()
  const add = (row: LiveRow) => {
    if (!rows.has(row.ref)) {
      rows.set(row.ref, row)
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
            const target = kitRef(item.ref)
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
            target: { host: state.adapter.agent, path: root },
            error: { _tag: 'ReadFailed', path: root, message: errorMessage(error) },
          })
        }
      }
      const perFile = new Map<string, number>()
      for (const head of heads) {
        perFile.set(head.ref.path, (perFile.get(head.ref.path) ?? 0) + 1)
      }
      // `discover` reports no mtime, and the cache key needs one.
      for (let start = 0; start < heads.length; start += STAT_BATCH) {
        const batch = heads.slice(start, start + STAT_BATCH)
        const infos = await Promise.all(batch.map(head => platform.fs.stat(head.ref.path, { followSymlinks: true })))
        batch.forEach((head, index) => {
          const info = infos[index]
          const target = kitRef(head.ref)
          if (info !== undefined && info.kind === 'file') {
            add(
              rowFromHead(
                target,
                head,
                { size: info.size, mtimeMs: info.mtimeMs },
                platform.home,
                (perFile.get(head.ref.path) ?? 0) > 1,
              ),
            )
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
