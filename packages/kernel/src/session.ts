/**
 * Trace's wire format and session index use `host`, while the kit's reference uses
 * `agent`, so this reference stays defined here.
 */
export interface SessionRef {
  host: string
  path: string
  sessionId?: string
}
