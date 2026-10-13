import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import type { SessionRef } from '@rivus/agent-trace-kernel'
import { splitSessionRef } from '@rivus/agent-trace-kernel'
import type { SessionTarget } from '@rivus/agent-kit/transcript'

/**
 * Opaque id: a hash of host and path, plus the session id when the path addresses one session
 * inside a file that holds several (the `path#id` form). The server's map turns it back into a file.
 */
export function sessionRefId(target: { host: string; path: string; sessionId?: string }): string {
  return createHash('sha256')
    .update(target.host)
    .update('\0')
    .update(target.path)
    .update('\0')
    .update(target.sessionId ?? '')
    .digest('hex')
    .slice(0, 24)
}

/** The kit target of a trace ref: the file, its session id, and the agent when the ref names one. */
export function kitTargetOf(target: string | SessionRef): SessionTarget {
  if (typeof target === 'string') {
    const split = splitSessionRef(target)
    return { path: split.file, ...(split.sessionId ? { sessionId: split.sessionId } : {}) }
  }
  return {
    agent: target.host,
    path: target.path,
    ...(target.sessionId ? { sessionId: target.sessionId } : {}),
  }
}

/** `path` or `path#sessionId`, the way error messages named a session before the kit. */
export function sessionRefLabel(target: { path: string; sessionId?: string }): string {
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
