import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { SessionTarget } from '@rivus/agent-kit/transcript'

/**
 * The trace id of a session: an opaque hash of agent and path, plus the session id when the path
 * addresses one session inside a file that holds several (the `path#id` form). The catalog turns it
 * back into a target. URLs and the session index hold these ids, so the hashed input must stay exactly this.
 */
export function traceIdOf(target: { agent: string; path: string; sessionId?: string }): string {
  return createHash('sha256')
    .update(target.agent)
    .update('\0')
    .update(target.path)
    .update('\0')
    .update(target.sessionId ?? '')
    .digest('hex')
    .slice(0, 24)
}

/** The `path` or `path#sessionId` string of a target, as the command line and error messages name a session. */
export function sessionTargetLabel(target: SessionTarget): string {
  return target.sessionId ? `${target.path}#${target.sessionId}` : target.path
}

/** One line for a terminal label: control characters and newlines become spaces; bidi and zero-width format characters are dropped. */
export function oneLine(text: string): string {
  return text
    .replace(/\p{Cf}+/gu, '')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The last segment of the working directory. */
export function projectName(cwd: string | undefined): string | undefined {
  if (!cwd) {
    return undefined
  }
  const name = basename(cwd)
  return name.length > 0 ? name : undefined
}
