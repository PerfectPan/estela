import { createHash } from 'node:crypto'
import { basename } from 'node:path'

/** Opaque id: a hash of host, path, and session id. The server's map turns it back into a file. */
export function sessionRefId(target: { host: string, path: string, sessionId?: string }): string {
  return createHash('sha256')
    .update(target.host)
    .update('\0')
    .update(target.path)
    .update('\0')
    .update(target.sessionId ?? '')
    .digest('hex')
    .slice(0, 24)
}

/** One line for a terminal label: control characters and newlines become spaces. */
export function oneLine(text: string): string {
  return text.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** The last segment of the working directory. */
export function projectName(cwd: string | undefined): string | undefined {
  if (!cwd)
    return undefined
  const name = basename(cwd)
  return name.length > 0 ? name : undefined
}
