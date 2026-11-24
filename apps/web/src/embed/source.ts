import type { EventDetail, TraceViewResult } from '@rivus/estela-rpc'
export { NoLogError, StaleError } from '@/workspace/load-errors.ts'

/** Host-provided data source for `<estela-workspace>`. */
export interface WorkspaceSource {
  /** Opens the session and resolves when its log is read and the view is built. Called again on every retry. */
  open(): Promise<TraceViewResult>
  /** One event in full, of the view identified by `traceId` (the id returned by `open`). */
  event(traceId: string, id: string): Promise<EventDetail>
}
