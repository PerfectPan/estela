import type { SessionsSignal } from './list-types.ts'

type Publish = (signal: SessionsSignal) => void

let publish: Publish | undefined
let latest: SessionsSignal | undefined

/** The dev server binds this to DevFrame shared state in `setup`. */
export function bindSessionPublisher(next: Publish): void {
  publish = next
  if (latest) {
    next(latest)
  }
}

export function emitSessions(signal: SessionsSignal): void {
  latest = signal
  publish?.(signal)
}
