import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { CURRENT_TRACE_ID, NAMESPACE } from '@rivus/estela-rpc'
import { createDevServer } from 'devframe/adapters/dev'
import { resolveWsUrl } from 'devframe/client'
import { createRpcClient } from 'devframe/rpc/client'
import { createWsRpcChannel } from 'devframe/rpc/transports/ws-client'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { BASE_PATH, createEstelaServer, type EstelaServer } from '../src/index.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const fixture = join(repo, 'fixtures/sessions/claude-code/conformance/plain/session.jsonl')

/** The slice of each RPC result this test reads. */
const loaded = z.object({ loadId: z.string(), cached: z.boolean() })
const view = z.object({
  traceId: z.string(),
  trace: z.object({ agent: z.string(), events: z.array(z.object({ id: z.string() })) }),
})
const detail = z.object({ id: z.string(), original: z.unknown() })
const listed = z.object({ rows: z.array(z.object({ traceId: z.string() })) })
/** The `websocket` entry of `__connection.json`, in the forms DevFrame's `ConnectionMeta` allows. */
const connection = z.object({
  websocket: z.union([
    z.number(),
    z.string(),
    z.object({ path: z.optional(z.string()), port: z.optional(z.number()), host: z.optional(z.string()) }),
  ]),
})

/**
 * A WebSocket RPC client in Node. `connectDevframe` reads the page's `location`, which Node does not
 * have, so this resolves the socket URL from `__connection.json` the way it does and opens the channel.
 */
async function rpcClient(origin: string) {
  const metaUrl = `${origin}${BASE_PATH}__connection.json`
  const meta = z.parse(connection, await (await fetch(metaUrl)).json())
  const url = resolveWsUrl(meta.websocket, metaUrl, new URL(origin))
  const channel = createWsRpcChannel({ url })
  const rpc = createRpcClient<Record<string, (...args: unknown[]) => Promise<unknown>>>({}, { channel })
  return {
    call: (method: string, ...args: unknown[]) => rpc.$call(`${NAMESPACE}:${method}`, ...args),
    close: channel.close,
  }
}

describe('the Estela server from its factory alone', () => {
  let home: string
  let server: EstelaServer
  let close: () => Promise<void>
  let disconnect: () => void
  let call: (method: string, ...args: unknown[]) => Promise<unknown>

  beforeAll(async () => {
    // An empty home: no agent roots exist, so the catalog lists no rows and only the launch session resolves.
    home = await mkdtemp(join(tmpdir(), 'estela-server-'))
    server = createEstelaServer({
      app: {
        packageName: '@rivus/estela',
        version: '0.0.0-test',
        homepage: 'https://example.invalid',
        description: 'test',
        clientAssets: home,
      },
      platform: createNodePlatform({ home, env: {} }),
      catalog: { index: false },
      launch: { path: fixture },
      redacts: true,
    })
    // No CLI code: DevFrame's dev adapter runs the definition's setup, which loads the launch session.
    const started = await createDevServer(server.definition, {
      host: '127.0.0.1',
      port: 0,
      auth: false,
      openBrowser: false,
      mcp: false,
    })
    close = started.close
    const client = await rpcClient(started.origin)
    call = client.call
    disconnect = client.close
  })

  afterAll(async () => {
    disconnect()
    await close()
    server.close()
    await rm(home, { recursive: true, force: true })
  })

  it('serves the launch session as current through load-trace, get-trace-view, and get-event', async () => {
    // Setup loaded the launch session and seeded the store with it, so this load is a cache hit.
    const load = z.parse(loaded, await call('load-trace', { traceId: CURRENT_TRACE_ID }))
    expect(load.cached).toBe(true)
    const { trace } = z.parse(view, await call('get-trace-view', { traceId: CURRENT_TRACE_ID }))
    expect(trace.agent).toBe('claude-code')
    expect(trace.events.length).toBeGreaterThan(0)
    const first = z.parse(detail, await call('get-event', { traceId: CURRENT_TRACE_ID, id: trace.events[0]!.id }))
    expect(first.id).toBe(trace.events[0]!.id)
    expect(first.original).toBeDefined()
  })

  it('resolves the launch session by its list-row trace id too', async () => {
    const launched = (await server.openLaunch())!
    const { trace } = z.parse(view, await call('get-trace-view', { traceId: launched.traceId }))
    expect(trace.events.length).toBe(launched.trace.events.length)
    const { rows } = z.parse(listed, await call('list-sessions', {}))
    expect(rows).toEqual([])
  })
})
