import type { AgentProgress } from '@rivus/estela-server'
import { log, progress } from '@clack/prompts'
import { isPlainOutput } from './terminal.ts'

/** Files read / total; the total shows `…` until the agent's roots have been listed. */
function count(agent: AgentProgress): string {
  return `${agent.read}/${agent.total ?? (agent.done ? agent.read : '…')}`
}

/** Plain mode, one line per agent when done: `Claude Code: 4/4 files read`. */
function formatIndexLine(agent: AgentProgress): string {
  const unreadable = agent.unreadable ? `, could not read ${agent.unreadable}` : ''
  if (agent.checked) {
    return `${agent.name}: 0 files, checked ${agent.checked}${unreadable}`
  }
  // No root was listed, so there is no total to count against: the sessions read stand alone.
  if (agent.unreadable && agent.total === undefined) {
    return agent.read === 0
      ? `${agent.name}: 0 files${unreadable}`
      : `${agent.name}: ${agent.read} files read${unreadable}`
  }
  return `${agent.name}: ${count(agent)} files read${unreadable}`
}

function formatTick(agent: AgentProgress): string {
  if (agent.checked || (agent.unreadable && agent.total === undefined)) {
    return `${agent.name} ${agent.unreadable ? agent.read : 0}`
  }
  return `${agent.name} ${count(agent)}`
}

const TICK_MS = 80

/** The "Session index" terminal moment: clack `progress` in a TTY, plain lines otherwise. */
export function startSessionIndex(): {
  tick: (agents: readonly AgentProgress[]) => void
  finish: () => void
  cancel: () => void
} {
  let latest: readonly AgentProgress[] = []
  if (isPlainOutput()) {
    const printed = new Set<string>()
    const printDone = () => {
      for (const agent of latest) {
        if (agent.done && !printed.has(agent.name)) {
          printed.add(agent.name)
          process.stdout.write(`${formatIndexLine(agent)}\n`)
        }
      }
    }
    return {
      tick(agents) {
        latest = agents
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
    tick(agents) {
      latest = agents
      bar ??= (() => {
        const created = progress({ max: Math.max(agents.length, 1) })
        created.start('Session index')
        return created
      })()
      const finished = agents.filter(agent => agent.done).length
      const now = Date.now()
      if (finished === advanced && now - last < TICK_MS) {
        return
      }
      last = now
      const text = `Session index · ${agents.map(formatTick).join(' · ')}`
      if (finished > advanced) {
        bar.advance(finished - advanced, text)
        advanced = finished
      } else {
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
export function sayIndexFromCache(agents: readonly { name: string; count: number }[]): void {
  const lines = agents.map(agent => `${agent.name}: ${agent.count} sessions from the index`)
  if (isPlainOutput()) {
    process.stdout.write(`${lines.join('\n')}\n`)
    return
  }
  log.step(
    `Session index · ${agents.map(agent => `${agent.name} ${agent.count}`).join(' · ')} · from the index, refreshing`,
  )
}
