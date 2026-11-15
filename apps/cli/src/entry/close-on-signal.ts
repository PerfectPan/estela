import process from 'node:process'

const SIGNALS = ['SIGINT', 'SIGTERM'] as const

/**
 * Runs `close` when SIGINT or SIGTERM arrives, then sends that signal again with no handler left, so it
 * ends the process as it would have without one. The session catalog writes finished summaries to the
 * index in batches; a signal between two writes would otherwise drop the last batch.
 */
export function closeOnSignal(close: () => void): void {
  const handlers = SIGNALS.map(signal => {
    const handler = () => {
      for (const [other, registered] of handlers) {
        process.off(other, registered)
      }
      try {
        close()
      } catch {
        // The index is a cache: a failed write costs a re-read next launch, and the signal still ends the process.
      }
      process.kill(process.pid, signal)
    }
    return [signal, handler] as const
  })
  for (const [signal, handler] of handlers) {
    process.on(signal, handler)
  }
}
