import { createHash } from 'node:crypto'
import { basename } from 'node:path'

/** Opaque id: a hash of host and path. The server's map turns it back into a file. */
export function sessionRefId(host: string, path: string): string {
  return createHash('sha256').update(host).update('\0').update(path).digest('hex').slice(0, 24)
}

/** The last segment of the working directory. */
export function projectName(cwd: string | undefined): string | undefined {
  if (!cwd)
    return undefined
  const name = basename(cwd)
  return name.length > 0 ? name : undefined
}
