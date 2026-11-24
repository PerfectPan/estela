import type { EventDetail, TraceViewResult } from '@rivus/estela-rpc'

/** Host-provided data source for `<estela-workspace>`. */
export interface WorkspaceSource {
  /** Opens the session and resolves when its log is read and the view is built. Called again on every retry. */
  open(): Promise<TraceViewResult>
  /** One event in full, of the view that `open` resolved last. */
  event(id: string): Promise<EventDetail>
}

/** `open` rejects with it when the session has not written a log yet. */
export class NoLogError extends Error {
  constructor(message = 'This session has no log on disk yet.') {
    super(message)
    this.name = 'NoLogError'
  }
}

/** `event` rejects with it when the log changed since the view was built; the element then calls `open` again. */
export class StaleError extends Error {
  constructor(message = 'Session log changed since the view was built.') {
    super(message)
    this.name = 'StaleError'
  }
}
