import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { splitSessionRef } from '@rivus/agent-trace-kernel'
import type { SessionTarget } from '@rivus/agent-kit/transcript'

/**
 * Opaque id: a hash of agent and path, plus the session id when the path addresses one session
 * inside a file that holds several (the `path#id` form). The server's map turns it back into a file.
 * URLs and the session index hold these ids, so the hashed input must stay exactly this.
 */
export function sessionRefId(target: { agent: string; path: string; sessionId?: string }): string {
  return createHash('sha256')
    .update(target.agent)
    .update('\0')
    .update(target.path)
    .update('\0')
    .update(target.sessionId ?? '')
    .digest('hex')
    .slice(0, 24)
}

/** The kit target of a `file` or `file#sessionId` input. It names no agent, so the kit's `detect` picks the adapter. */
export function targetOfPath(input: string): SessionTarget {
  const split = splitSessionRef(input)
  return { path: split.file, ...(split.sessionId ? { sessionId: split.sessionId } : {}) }
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
