import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import process from 'node:process'
import type { SessionTarget } from '@rivus/agent-kit/transcript'

/**
 * A session path as the kit reads it. The kit joins and splits session paths on `/` only (its
 * Claude Code subagent directory, Codex rollout names, Grok session directories), so on Windows a
 * path's `\` separators become `/`, which Node's fs also takes. Other systems keep the path as given.
 */
export function toKitPath(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? path.replaceAll('\\', '/') : path
}

/**
 * The trace id of a session: an opaque hash of agent and path, plus the session id when the path
 * addresses one session inside a file that holds several (the `path#id` form). The catalog turns it
 * back into a target. URLs and the session index hold these ids, so the hashed input must stay exactly this.
 * The path is hashed in its {@link toKitPath} form: on Windows discovery yields the home directory's
 * `\` followed by the kit's `/`, and a path typed on the command line has `\` only.
 */
export function traceIdOf(target: { agent: string; path: string; sessionId?: string }): string {
  return createHash('sha256')
    .update(target.agent)
    .update('\0')
    .update(toKitPath(target.path))
    .update('\0')
    .update(target.sessionId ?? '')
    .digest('hex')
    .slice(0, 24)
}

/**
 * The kit's `SessionTarget` of a `path` or `path#sessionId` string, the form a session takes on the command line. It
 * names no agent, so the kit's `detect` picks the adapter. A `#` at the start is part of the path, and a trailing `#`
 * names no session.
 */
export function parseSessionTarget(input: string): SessionTarget {
  const hash = input.lastIndexOf('#')
  if (hash <= 0) {
    return { path: input }
  }
  const sessionId = input.slice(hash + 1)
  return sessionId ? { path: input.slice(0, hash), sessionId } : { path: input.slice(0, hash) }
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
