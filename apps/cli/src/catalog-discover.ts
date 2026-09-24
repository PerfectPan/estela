import type { HostAdapter, HostEnv, SessionHead, TraceIO } from '@rivus/agent-trace-kernel'
import { redactText } from '@rivus/agent-trace-kernel'
import { errorRow, isDiscoverError, rowFromHead, type LiveRow } from './catalog-rows.ts'
import { errorMessage } from './read-failure.ts'

/** Parallel `stat` calls while building rows. */
const STAT_BATCH = 64

export interface HostState {
  adapter: HostAdapter
  /** Files whose head and tail were read. */
  read: number
  done: boolean
  found: string[]
  missing: string[]
}

export interface HostProgress {
  id: string
  name: string
  read: number
  done: boolean
  /** Set when no root exists: the paths that were checked, with `~`. */
  checked?: string
}

export function hostState(adapter: HostAdapter): HostState {
  return { adapter, read: 0, done: false, found: [], missing: [] }
}

export function progressOf(states: readonly HostState[], homeDir: string): HostProgress[] {
  return states.map((state) => {
    const checked = state.done && state.found.length === 0
      ? state.missing.map(path => redactText(path, homeDir)).join(', ')
      : undefined
    return {
      id: state.adapter.id,
      name: state.adapter.displayName,
      read: state.read,
      done: state.done,
      ...(checked ? { checked } : {}),
    }
  })
}

/**
 * One `discover` pass over every host: roots → head/tail reads → rows keyed by ref.
 * Hosts run side by side; each adapter's own `discover` stays sequential.
 * A missing root is recorded on the host (S3). An unreadable file becomes an error row (S4).
 */
export async function discoverRows(
  states: readonly HostState[],
  io: TraceIO,
  env: HostEnv,
  report: () => void,
): Promise<Map<string, LiveRow>> {
  const rows = new Map<string, LiveRow>()
  const add = (row: LiveRow) => {
    if (!rows.has(row.ref))
      rows.set(row.ref, row)
  }
  await Promise.all(states.map(async (state) => {
    const heads: SessionHead[] = []
    for (const root of state.adapter.roots(env)) {
      const info = await io.stat(root)
      if (info?.kind !== 'dir') {
        state.missing.push(root)
        continue
      }
      state.found.push(root)
      try {
        for await (const item of state.adapter.discover(root, io, {})) {
          if (isDiscoverError(item)) {
            if (item.ref.path !== root)
              add(errorRow({ ...item.ref, host: state.adapter.id }, item.error, env.homeDir))
          }
          else {
            heads.push(item)
          }
          state.read += 1
          report()
        }
      }
      catch (error) {
        add(errorRow({ host: state.adapter.id, path: root }, errorMessage(error), env.homeDir))
      }
    }
    // `discover` reports no mtime, and the cache key needs one.
    for (let start = 0; start < heads.length; start += STAT_BATCH) {
      const batch = heads.slice(start, start + STAT_BATCH)
      const infos = await Promise.all(batch.map(head => io.stat(head.ref.path)))
      batch.forEach((head, index) => {
        const info = infos[index]
        const target = { ...head.ref, host: state.adapter.id }
        if (info?.kind === 'file')
          add(rowFromHead(state.adapter.id, head, info, env.homeDir))
        else
          add(errorRow(target, `${state.adapter.id}: ${target.path} does not exist`, env.homeDir))
      })
    }
    state.done = true
    report()
  }))
  return rows
}
