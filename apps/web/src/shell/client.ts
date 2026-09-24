import type { DevframeRpcClient, DevframeScopedClientContext } from 'devframe/client'
import { connectDevframe } from 'devframe/client'

const NAMESPACE = 'agent-trace'
/** Long enough to type the one-time code by hand when the URL did not carry it. */
const TRUST_TIMEOUT_MS = 10 * 60_000

export type ScopedClient = DevframeScopedClientContext<typeof NAMESPACE>

let connecting: Promise<DevframeRpcClient> | undefined
let trusted: Promise<DevframeRpcClient> | undefined

/** One DevFrame connection for the page. `connectDevframe` opens a new socket per call. */
export function devframeClient(): Promise<DevframeRpcClient> {
  connecting ??= connectDevframe()
  return connecting
}

/**
 * The connection once DevFrame's auth gate has trusted it. `connectDevframe` returns before
 * its auth bootstrap reads the one-time code from the URL fragment, so nothing may rewrite
 * the URL, or call the server, until this resolves.
 */
export function trustedClient(): Promise<DevframeRpcClient> {
  trusted ??= devframeClient().then(async (client) => {
    if (client.transport !== 'static' && !client.isTrusted)
      await client.ensureTrusted(TRUST_TIMEOUT_MS).catch(() => false)
    return client
  })
  return trusted
}

export async function scopedClient(): Promise<ScopedClient> {
  return (await trustedClient()).scope(NAMESPACE) as ScopedClient
}

/** A static build (the report) has no live server: no session list, one baked trace. */
export async function isStaticBuild(): Promise<boolean> {
  try {
    return (await devframeClient()).transport === 'static'
  }
  catch {
    return false
  }
}
