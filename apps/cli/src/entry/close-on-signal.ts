import process from 'node:process'

/** Ctrl-C, a kill, and a closed terminal (also a closed console window on Windows). */
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

/**
 * Runs `close` when one of `SIGNALS` arrives, then sends that signal again with no handler left, so it
 * ends the process as it would have without one. The session catalog writes finished summaries to the
 * index in batches; a signal between two writes would otherwise drop the last batch. Returns a function
 * that removes the handlers, for a caller that closes the server itself.
 */
export function closeOnSignal(close: () => void): () => void {
  const handlers = new Map<NodeJS.Signals, () => void>()
  const remove = () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler)
    }
  }
  for (const signal of SIGNALS) {
    const handler = () => {
      remove()
      try {
        close()
      } catch {
        // The index is a cache: a failed write costs a re-read next launch, and the signal still ends the process.
      }
      process.kill(process.pid, signal)
    }
    handlers.set(signal, handler)
    process.on(signal, handler)
  }
  return remove
}
