import type { HostProgress } from './catalog-discover.ts'
import { log, progress } from '@clack/prompts'
import { isPlainOutput } from './terminal.ts'

/** Files read / total; the total shows `…` until the host has listed its files. */
function count(host: HostProgress): string {
  return `${host.read}/${host.total ?? (host.done ? host.read : '…')}`
}

/** Plain mode, one line per host when done: `Claude Code: 4/4 files read`. */
function formatIndexLine(host: HostProgress): string {
  if (host.checked)
    return `${host.name}: 0 files, checked ${host.checked}`
  return `${host.name}: ${count(host)} files read`
}

function formatTick(host: HostProgress): string {
  return host.checked ? `${host.name} 0` : `${host.name} ${count(host)}`
}

const TICK_MS = 80

/** The "Session index" terminal moment (plan 3.1): clack `progress` in a TTY, plain lines otherwise. */
export function startSessionIndex(): {
  tick: (hosts: readonly HostProgress[]) => void
  finish: () => void
  cancel: () => void
} {
  let latest: readonly HostProgress[] = []
  if (isPlainOutput()) {
    const printed = new Set<string>()
    const printDone = () => {
      for (const host of latest) {
        if (host.done && !printed.has(host.name)) {
          printed.add(host.name)
          process.stdout.write(`${formatIndexLine(host)}\n`)
        }
      }
    }
    return {
      tick(hosts) {
        latest = hosts
        printDone()
      },
      finish: printDone,
      cancel() {},
    }
  }
  let bar: ReturnType<typeof progress> | undefined
  let advanced = 0
  let last = 0
  return {
    tick(hosts) {
      latest = hosts
      bar ??= (() => {
        const created = progress({ max: Math.max(hosts.length, 1) })
        created.start('Session index')
        return created
      })()
      const finished = hosts.filter(host => host.done).length
      const now = Date.now()
      if (finished === advanced && now - last < TICK_MS)
        return
      last = now
      const text = `Session index · ${hosts.map(formatTick).join(' · ')}`
      if (finished > advanced) {
        bar.advance(finished - advanced, text)
        advanced = finished
      }
      else {
        bar.message(text)
      }
    },
    finish() {
      bar?.stop(`Session index · ${latest.map(formatTick).join(' · ')}`)
      bar = undefined
    },
    cancel() {
      bar?.cancel('Session index failed')
      bar = undefined
    },
  }
}

/** Second launch: rows came from the index at once; `discover` refreshes them after Ready. */
export function sayIndexFromCache(hosts: readonly { name: string, count: number }[]): void {
  const lines = hosts.map(host => `${host.name}: ${host.count} sessions from the index`)
  if (isPlainOutput()) {
    process.stdout.write(`${lines.join('\n')}\n`)
    return
  }
  log.step(`Session index · ${hosts.map(host => `${host.name} ${host.count}`).join(' · ')} · from the index, refreshing`)
}
