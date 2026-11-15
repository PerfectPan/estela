import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir } from 'node:fs/promises'
import { isIP, isIPv4 } from 'node:net'
import { join } from 'node:path'
import process from 'node:process'
import * as z from 'zod/mini'

const errnoSchema = z.object({ code: z.string() })

function errorCode(error: unknown): string | undefined {
  const parsed = errnoSchema.safeParse(error)
  return parsed.success ? parsed.data.code : undefined
}

/** Strips whitespace, outer IPv6 brackets, and case from a host string. */
export function unbracketHost(host: string): string {
  const trimmed = host.trim().toLowerCase()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** True for wildcard bind hosts (`0.0.0.0`, `::`, and expanded IPv6 zero). */
export function isWildcardHost(host: string): boolean {
  const bare = unbracketHost(host)
  return (
    bare === '0.0.0.0'
    || bare === '::'
    || bare === '0:0:0:0:0:0:0:0'
    || bare === '0000:0000:0000:0000:0000:0000:0000:0000'
  )
}

/** True only for loopback hosts (`localhost`, `127.*`, or `::1`). Wildcards (`0.0.0.0`, `::`) return false. */
export function isLoopbackHost(host: string): boolean {
  const bare = unbracketHost(host)
  if (bare === 'localhost' || bare === '::1' || bare === '0:0:0:0:0:0:0:1') {
    return true
  }
  return isIPv4(bare) && bare.startsWith('127.')
}

function formatAuthorityHost(bareHost: string): string {
  return isIP(bareHost) === 6 ? `[${bareHost}]` : bareHost
}

/**
 * Origin a local client should dial and print for `host` and `port`. Preserves explicit loopback
 * literals such as `127.0.0.1` and `[::1]` instead of rewriting them to `localhost`, which can
 * resolve to the opposite IP family and hit a different listener.
 */
export function dialableOrigin(host: string, port: number, fallbackOrigin: string): string {
  const bare = unbracketHost(host)
  if (bare === '' || isWildcardHost(bare)) {
    return fallbackOrigin
  }
  if (isLoopbackHost(bare)) {
    return `http://${formatAuthorityHost(bare)}:${port}`
  }
  return fallbackOrigin
}

/** `WsOriginRegistry`-compatible allowlist locking browser `Origin` checks to the bound server origin and port. */
export interface ServerOriginGate {
  setPort: (port: number) => void
  registry: {
    readonly token: string
    registerFromUrl: (url: string) => string | undefined
    isAllowed: (origin: string | undefined) => boolean
  }
}

/**
 * Restricts browser `Origin` headers on WebSocket and SSE upgrades to this server's bound port
 * and host, rejecting `Origin: null` and cross-port loopback pages (e.g. `localhost:3000`).
 * Requests without an `Origin` header (non-browser clients) remain allowed.
 */
export function createServerOriginGate(host: string, initialPort?: number): ServerOriginGate {
  const bareHost = unbracketHost(host)
  const wildcard = bareHost === '' || isWildcardHost(bareHost)
  let activePort = initialPort

  const isAllowed = (origin: string | undefined): boolean => {
    if (origin === undefined) {
      return true
    }
    if (origin.length === 0 || origin === 'null' || activePort === undefined) {
      return false
    }
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      return false
    }
    if (parsed.protocol !== 'http:' || parsed.username !== '' || parsed.password !== '') {
      return false
    }
    const originPort = parsed.port === '' ? 80 : Number(parsed.port)
    if (originPort !== activePort) {
      return false
    }
    if (wildcard) {
      return true
    }
    return unbracketHost(parsed.hostname) === bareHost
  }

  return {
    setPort(port: number) {
      activePort = port
    },
    registry: {
      token: randomBytes(16).toString('hex'),
      registerFromUrl() {
        return undefined
      },
      isAllowed,
    },
  }
}

/**
 * Ensures `~/.estela/devframe` exists with `0o700` permissions (and `auth.json` has `0o600` if present)
 * on POSIX systems, without following symbolic links.
 */
export async function secureDevframeDir(home: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }
  const dir = join(home, '.estela', 'devframe')
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const dirStats = await lstat(dir)
  if (!dirStats.isSymbolicLink() && dirStats.isDirectory()) {
    await chmod(dir, 0o700)
  }

  const authFile = join(dir, 'auth.json')
  try {
    const fileStats = await lstat(authFile)
    if (!fileStats.isSymbolicLink() && fileStats.isFile()) {
      await chmod(authFile, 0o600)
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      throw error
    }
  }
}
