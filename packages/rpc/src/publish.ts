import type { SessionsSignal } from './list-types.ts'

type Publish = (signal: SessionsSignal) => void

/** Per-instance session-change publisher: buffers the latest signal until `setup` binds shared state. */
export interface SessionPublisher {
  /** The dev server binds this to DevFrame shared state in `setup`. */
  bind: (next: Publish) => void
  emit: (signal: SessionsSignal) => void
}

export function createSessionPublisher(): SessionPublisher {
  let publish: Publish | undefined
  let latest: SessionsSignal | undefined
  return {
    bind(next) {
      publish = next
      if (latest) {
        next(latest)
      }
    },
    emit(signal) {
      latest = signal
      publish?.(signal)
    },
  }
}
