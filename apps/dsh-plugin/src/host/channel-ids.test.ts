import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEstelaCore } from '@rivus/estela-server/core'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { createChannelHost } from './channel.ts'
import type { HostPeer, HostSessionPersistence, RpcHandlerResult } from './rpc.ts'
import { createSessionRegistry } from './sessions.ts'

/**
 * The dsh reader names an event after its log file and line, and a dsh log is always `session.v4.jsonl`: a main-lane
 * id is `session.v4.jsonl:2`, which no redaction changes. So the plugin never shows an alias in a view, but its
 * channel carries one back: `trace/event` takes the `@e<seq>` form the TraceStore gives unsafe ids elsewhere.
 */
const processHome = homedir()
const ownerPeer: HostPeer = { principal: { kind: 'owner' } }
const dirs: string[] = []

const openValue = z.object({ traceId: z.string() })
const viewValue = z.object({ traceId: z.string(), trace: z.object({ events: z.array(z.object({ id: z.string() })) }) })
const eventValue = z.object({ id: z.string(), original: z.unknown() })

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-host-ids-'))
  dirs.push(home)
  return home
}

function namesNeitherHome(text: string, home: string): void {
  for (const needle of [home, JSON.stringify(home).slice(1, -1), processHome]) {
    expect(text).not.toContain(needle)
  }
}

describe('dsh host channel and event ids', () => {
  it('serves recorded ids as they are, and reads an event back by the alias form too', async () => {
    const home = await makeTempHome()
    const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
    const file = join(home, 's', 'session.v4.jsonl')
    await mkdir(dirname(file))
    // The conformance log of a plain session: several events, under the fixed name the reader knows.
    await cp(join(repo, 'fixtures/sessions/dsh/conformance/plain/session.v4.jsonl'), file)
    const persistence: HostSessionPersistence = { stat: async () => ({ location: { kind: 'jsonl', path: file } }) }
    const base = createEstelaCore({ redacts: false }).platform
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = createEstelaCore({
      platform: { ...base, home, env: {} },
      redacts: true,
      resolve: id => registry.resolve(id),
    })
    registry = createSessionRegistry({
      persistence,
      fs: core.platform.fs,
      store: core.store,
      redact: core.redact,
    })
    const channel = createChannelHost({ core, sessions: registry })
    const call = (endpoint: string, payload: unknown): Promise<RpcHandlerResult> =>
      channel.handler(endpoint, payload, new AbortController().signal, ownerPeer)

    const opened = await call('session/open', { sessionId: 's' })
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }
    const { traceId } = z.parse(openValue, opened.value)
    const viewRes = await call('trace/view', { traceId })
    expect(viewRes.ok).toBe(true)
    if (!viewRes.ok) {
      return
    }
    const view = z.parse(viewValue, viewRes.value)
    expect(view.traceId).toBe(traceId)
    const ids = view.trace.events.map(event => event.id)
    expect(ids.length).toBeGreaterThan(1)
    // Recorded ids: the log's fixed name and a line number, with a request prefix or a part after it.
    expect(ids.every(id => /^(request:)?session\.v4\.jsonl:\d+(:\d+)?$/.test(id))).toBe(true)
    // The text is redacted as on the dev server.
    namesNeitherHome(JSON.stringify(view), home)

    for (const [index, id] of ids.entries()) {
      // By the id the view shows, and by the alias of the same position.
      for (const asked of [id, `@e${index}`]) {
        const eventRes = await call('trace/event', { traceId, id: asked })
        expect(eventRes.ok).toBe(true)
        if (!eventRes.ok) {
          return
        }
        const event = z.parse(eventValue, eventRes.value)
        // A safe id is shown as recorded, whichever form named it.
        expect(event.id).toBe(id)
        expect(event.original).toBeDefined()
        namesNeitherHome(JSON.stringify(event), home)
      }
    }
    const beyond = `@e${ids.length}`
    const missing = await call('trace/event', { traceId, id: beyond })
    expect(missing).toEqual({
      ok: false,
      error: { code: 'estela/failed', message: `no event ${beyond} in ${traceId}`, details: {} },
    })
    channel.dispose()
  })
})
