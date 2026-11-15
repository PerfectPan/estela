import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, stat } from 'node:fs/promises'
import { isIP, isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { errorMessage } from '@rivus/estela-server'
import * as z from 'zod/mini'
import { sanitizeInline } from './failure.ts'

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

/** Canonicalizes hostnames and IPv4/IPv6 literals (e.g. expanded IPv6 -> compressed form) without outer brackets. */
export function canonicalizeHost(host: string): string {
  const bare = unbracketHost(host)
  if (bare === '') {
    return ''
  }
  try {
    if (isIP(bare) === 6) {
      return unbracketHost(new URL(`http://[${bare}]/`).hostname)
    }
    if (/[@/?#\\:\s]/.test(bare)) {
      return bare
    }
    return unbracketHost(new URL(`http://${bare}/`).hostname)
  } catch {
    return bare
  }
}

/** True for wildcard bind hosts (`0.0.0.0`, `::`, and expanded IPv6 zero). */
export function isWildcardHost(host: string): boolean {
  const canon = canonicalizeHost(host)
  return canon === '0.0.0.0' || canon === '::'
}

/** True only for loopback hosts (`localhost`, `127.*`, or `::1`). Wildcards (`0.0.0.0`, `::`) return false. */
export function isLoopbackHost(host: string): boolean {
  const canon = canonicalizeHost(host)
  if (canon === 'localhost' || canon === '::1') {
    return true
  }
  return isIPv4(canon) && canon.startsWith('127.')
}

function formatAuthorityHost(bareHost: string): string {
  return isIP(bareHost) === 6 ? `[${bareHost}]` : bareHost
}

/**
 * Origin a local client should dial and print for `host` and `port`. Explicit loopback literals
 * such as `127.0.0.1` and `[::1]` stay as given, and a wildcard bind maps to the loopback address
 * of its own family (`0.0.0.0` → `127.0.0.1`, `::` → `[::1]`): `localhost` can resolve to the
 * other family first and reach a different process listening on the same port there.
 */
export function dialableOrigin(host: string, port: number, fallbackOrigin: string): string {
  const canon = canonicalizeHost(host)
  if (canon === '') {
    return fallbackOrigin
  }
  if (isWildcardHost(canon)) {
    return `http://${canon === '::' ? '[::1]' : '127.0.0.1'}:${port}`
  }
  if (isLoopbackHost(canon)) {
    return `http://${formatAuthorityHost(canon)}:${port}`
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

function defaultInterfaceAddresses(): string[] {
  let ifaces: ReturnType<typeof networkInterfaces>
  try {
    ifaces = networkInterfaces()
  } catch {
    return []
  }
  const addresses: string[] = []
  for (const entries of Object.values(ifaces)) {
    if (!entries) {
      continue
    }
    for (const entry of entries) {
      const address = entry.address.split('%')[0] ?? ''
      if (address !== '') {
        addresses.push(address)
      }
    }
  }
  return addresses
}

/**
 * Restricts browser `Origin` headers on WebSocket and SSE upgrades to this server's bound port
 * and host, rejecting `Origin: null`, cross-port loopback pages (e.g. `localhost:3000`), and
 * arbitrary DNS hostnames on wildcard binds (to block DNS rebinding). Requests without an `Origin`
 * header (non-browser clients) remain allowed.
 */
export function createServerOriginGate(host: string, localAddresses?: () => Iterable<string>): ServerOriginGate {
  const canonBind = canonicalizeHost(host)
  const wildcard = canonBind !== '' && isWildcardHost(canonBind)
  const readInterfaces = localAddresses ?? defaultInterfaceAddresses
  let activePort: number | undefined

  const isLocalInterfaceIp = (originIp: string): boolean => {
    let entries: Iterable<string>
    try {
      entries = readInterfaces()
    } catch {
      return false
    }
    for (const addr of entries) {
      const stripped = addr.split('%')[0] ?? ''
      if (stripped !== '' && canonicalizeHost(stripped) === originIp) {
        return true
      }
    }
    return false
  }

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
    const originHost = canonicalizeHost(parsed.hostname)
    if (canonBind === '' || canonBind === 'localhost') {
      return isLoopbackHost(originHost)
    }
    if (wildcard) {
      if (isLoopbackHost(originHost)) {
        return true
      }
      if (isIP(originHost) === 0) {
        return false
      }
      return isLocalInterfaceIp(originHost)
    }
    return originHost === canonBind
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
 * Restricts `~/.estela/devframe` to mode `0o700` on POSIX (and tightens an existing regular
 * `auth.json` to `0o600` if present) without following symlinks. Best-effort: reports a warning
 * and returns without throwing when `HOME` cannot be written or a path component is not a directory.
 */
export async function secureDevframeDir(home: string, warn?: (message: string) => void): Promise<void> {
  if (process.platform === 'win32') {
    return
  }
  const estelaRoot = join(home, '.estela')
  try {
    const estelaStats = await lstat(estelaRoot)
    if (estelaStats.isSymbolicLink()) {
      const resolvedStats = await stat(estelaRoot).catch(() => undefined)
      if (!resolvedStats?.isDirectory()) {
        warn?.(
          '~/.estela is a symbolic link that does not point to a directory; skipping DevFrame storage permission hardening',
        )
        return
      }
    } else if (!estelaStats.isDirectory()) {
      warn?.('~/.estela is not a directory; skipping DevFrame storage permission hardening')
      return
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      warn?.(`Could not set permissions on ~/.estela/devframe: ${sanitizeInline(errorMessage(error))}`)
      return
    }
  }

  const dir = join(estelaRoot, 'devframe')
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const dirStats = await lstat(dir)
    if (dirStats.isSymbolicLink()) {
      warn?.('~/.estela/devframe is a symbolic link; skipping DevFrame storage permission hardening')
      return
    }
    if (!dirStats.isDirectory()) {
      warn?.('~/.estela/devframe is not a directory; skipping DevFrame storage permission hardening')
      return
    }
    await chmod(dir, 0o700)

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
  } catch (error) {
    warn?.(`Could not set permissions on ~/.estela/devframe: ${sanitizeInline(errorMessage(error))}`)
  }
}
