import { cp, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEstelaCore, type EstelaCore } from '@rivus/estela-server/core'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import * as z from 'zod/mini'
import { CHANNEL } from '../contract/channel.ts'
import { createChannelHost } from './channel.ts'
import { inject, name } from './index.ts'
import { mountHost } from './mount.ts'
import type {
  EffectDisposer,
  HostContext,
  HostPeer,
  HostSessionPersistence,
  RpcHandler,
  RpcHandlerResult,
} from './rpc.ts'
import { createSessionRegistry, FIXED_FAILURE_MESSAGE } from './sessions.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const plainFixture = join(repo, 'fixtures/sessions/dsh/conformance/plain/session.v4.jsonl')
const zstdFixture = join(repo, 'fixtures/sessions/dsh/conformance/plain/session.v4.jsonl.zstd')
const unknownGenFixture = join(repo, 'fixtures/sessions/dsh/unknown-generation/session.v4.jsonl')

const FAKE_USER = 'fake-dsh-user-bob'
const SECRET_TOKEN = 'sk-abcdefghijklmnop'
const processHome = homedir()
const ownerPeer: HostPeer = { principal: { kind: 'owner' } }
const dirs: string[] = []

const openValueSchema = z.object({ traceId: z.string() })
const viewValueSchema = z.object({
  traceId: z.string(),
  trace: z.object({ events: z.array(z.object({ id: z.string() })) }),
})
const eventValueSchema = z.object({ id: z.string(), original: z.unknown() })

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-'))
  dirs.push(root)
  const home = join(root, FAKE_USER)
  await mkdir(home, { recursive: true })
  return home
}

function namesNeitherHome(text: string, fakeHome: string): void {
  for (const needle of [fakeHome, JSON.stringify(fakeHome).slice(1, -1), processHome, FAKE_USER]) {
    expect(text).not.toContain(needle)
  }
}

function dshSessionText(id: string, prompt: string, cwd: string): string {
  return [
    JSON.stringify({ type: 'session', version: 4, id, createdAt: 1767225600000, cwd }),
    JSON.stringify({
      type: 'user/message',
      seq: 1,
      time: 1767225601000,
      data: { role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' }, id: `u-${id}` },
    }),
  ].join('\n')
}

function createFakeHostContext(persistence: HostSessionPersistence) {
  let registeredChannel: string | undefined
  let handler: RpcHandler | undefined
  let unregistered = false
  const disposers: EffectDisposer[] = []

  class FakeConnection {
    get rpc() {
      return {
        handle: (channel: string, fn: RpcHandler) => {
          registeredChannel = channel
          handler = fn
          return () => {
            unregistered = true
          }
        },
      }
    }
  }

  const ctx: HostContext = {
    connection: new FakeConnection(),
    sessionPersistence: persistence,
    effect(callback) {
      const cleanup = callback()
      if (cleanup) {
        disposers.push(cleanup)
      }
    },
  }

  return {
    ctx,
    call(
      endpoint: string,
      payload: unknown,
      options: { signal?: AbortSignal; peer?: HostPeer | undefined } = {},
    ): Promise<RpcHandlerResult> {
      if (!handler) {
        throw new Error('channel handler was not registered')
      }
      const peer = 'peer' in options ? options.peer : ownerPeer
      return handler(endpoint, payload, options.signal ?? new AbortController().signal, peer)
    },
    async dispose() {
      for (const cleanup of disposers.splice(0)) {
        await cleanup()
      }
    },
    unregistered: () => unregistered,
    registeredChannel: () => registeredChannel,
  }
}

function makePlatform(home: string, env: Record<string, string> = {}, fsOverride?: EstelaCore['platform']['fs']) {
  const base = createEstelaCore({ redacts: false }).platform
  return { ...base, home, env, ...(fsOverride ? { fs: fsOverride } : {}) }
}

describe('dsh host plugin and /estela channel', () => {
  it('exports plugin metadata, starts nothing at load, and serves open/view/event for plain and zstd logs', async () => {
    expect(name).toBe('@rivus/dsh-estela')
    expect(inject).toEqual(['connection', 'webServer', 'sessionPersistence'])

    const home = await makeTempHome()
    const statSpy = vi.fn<HostSessionPersistence['stat']>(async id => {
      if (id === 'plain') {
        return { location: { kind: 'jsonl', path: plainFixture } }
      }
      if (id === 'zstd') {
        return { location: { kind: 'jsonl', path: zstdFixture } }
      }
      return undefined
    })

    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const readSpy = vi.fn<EstelaCore['platform']['fs']['read']>(baseFs.read)
    const harness = createFakeHostContext({ stat: statSpy })
    mountHost(harness.ctx, { platform: makePlatform(home, {}, { ...baseFs, read: readSpy }) })

    // Nothing runs at plugin load.
    expect(harness.registeredChannel()).toBe(CHANNEL)
    expect(statSpy).not.toHaveBeenCalled()
    expect(readSpy).not.toHaveBeenCalled()

    for (const sessionId of ['plain', 'zstd']) {
      const opened = await harness.call('session/open', { sessionId })
      expect(opened.ok).toBe(true)
      if (!opened.ok) {
        return
      }
      const { traceId } = z.parse(openValueSchema, opened.value)

      const viewRes = await harness.call('trace/view', { traceId })
      expect(viewRes.ok).toBe(true)
      if (!viewRes.ok) {
        return
      }
      const view = z.parse(viewValueSchema, viewRes.value)
      expect(view.traceId).toBe(traceId)
      expect(view.trace.events.length).toBeGreaterThan(0)

      const firstId = view.trace.events[0]!.id
      const eventRes = await harness.call('trace/event', { traceId, id: firstId })
      expect(eventRes.ok).toBe(true)
      if (!eventRes.ok) {
        return
      }
      const event = z.parse(eventValueSchema, eventRes.value)
      expect(event.id).toBe(firstId)
      expect(event.original).toBeDefined()
    }

    await harness.dispose()
    expect(harness.unregistered()).toBe(true)
  })

  it('refuses bad-request, unknown-trace, and forbidden calls without reading files or calling the store (DSH-14)', async () => {
    const home = await makeTempHome()
    const file = join(home, 's.v4.jsonl')
    await writeFile(file, `${dshSessionText('s', 'hi', home)}\n`)

    const persistenceStat = vi.fn<HostSessionPersistence['stat']>(async () => ({
      location: { kind: 'jsonl', path: file },
    }))
    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const fsStat = vi.fn<EstelaCore['platform']['fs']['stat']>(baseFs.stat)
    const fsRead = vi.fn<EstelaCore['platform']['fs']['read']>(baseFs.read)

    const platform = makePlatform(home, {}, { ...baseFs, stat: fsStat, read: fsRead })
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = createEstelaCore({ platform, redacts: true, resolve: id => registry.resolve(id) })
    registry = createSessionRegistry({
      persistence: { stat: persistenceStat },
      fs: core.platform.fs,
      store: core.store,
      redact: core.redact,
    })
    const openSpy = vi.spyOn(core.store, 'open')
    const viewSpy = vi.spyOn(core.store, 'view')
    const eventSpy = vi.spyOn(core.store, 'event')
    const channel = createChannelHost({ core, sessions: registry })
    const signal = new AbortController().signal

    for (const peer of [{ principal: { kind: 'guest' } }, { principal: {} }, undefined]) {
      const res = await channel.handler('session/open', { sessionId: 's' }, signal, peer)
      expect(res).toEqual({
        ok: false,
        error: { code: 'estela/forbidden', message: 'only the owner may read sessions', details: {} },
      })
    }

    const badCalls: Array<[string, unknown]> = [
      ['unknown/endpoint', {}],
      ['session/open', {}],
      ['session/open', { sessionId: '' }],
      ['session/open', { sessionId: 'a'.repeat(257) }],
      ['session/open', { sessionId: 'bad\u0000id' }],
      ['trace/view', { traceId: 'line\nbreak' }],
      ['trace/event', { traceId: 'ok', id: '' }],
    ]
    for (const [endpoint, payload] of badCalls) {
      const res = await channel.handler(endpoint, payload, signal, ownerPeer)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('estela/bad-request')
        expect(res.error.details).toEqual({})
      }
    }

    for (const [endpoint, payload] of [
      ['trace/view', { traceId: 'not-issued' }],
      ['trace/event', { traceId: 'not-issued', id: 'e1' }],
    ] as const) {
      const res = await channel.handler(endpoint, payload, signal, ownerPeer)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('estela/unknown-trace')
        expect(res.error.details).toEqual({})
      }
    }

    // Forbidden, bad-request, and unknown-trace must never touch persistence, the filesystem, or the store.
    expect(persistenceStat).not.toHaveBeenCalled()
    expect(fsStat).not.toHaveBeenCalled()
    expect(fsRead).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
    expect(viewSpy).not.toHaveBeenCalled()
    expect(eventSpy).not.toHaveBeenCalled()
  })

  it('catches unexpected handler exceptions and returns estela/failed with the fixed message', async () => {
    const home = await makeTempHome()
    const harness = createFakeHostContext({
      stat: async () => {
        throw new Error(`secret crash in ${home}`)
      },
    })
    mountHost(harness.ctx, { platform: makePlatform(home) })

    const throwingPeer: HostPeer = {
      get principal(): never {
        throw new Error(`unexpected ${home}/${FAKE_USER}`)
      },
    }
    const fromDispatch = await harness.call('session/open', { sessionId: 's' }, { peer: throwingPeer })
    expect(fromDispatch).toEqual({
      ok: false,
      error: { code: 'estela/failed', message: FIXED_FAILURE_MESSAGE, details: {} },
    })

    const fromPersistence = await harness.call('session/open', { sessionId: 's' })
    expect(fromPersistence).toEqual({
      ok: false,
      error: { code: 'estela/failed', message: FIXED_FAILURE_MESSAGE, details: {} },
    })
  })

  it('reports no-log, unknown-generation, missing, and unreadable failures without leaking home paths (DSH-4, DSH-5)', async () => {
    const home = await makeTempHome()
    const unknownCopy = join(home, 'unknown-gen/session.v4.jsonl')
    await mkdir(dirname(unknownCopy), { recursive: true })
    await cp(unknownGenFixture, unknownCopy)

    const vanishing = join(home, 'vanishing.v4.jsonl')
    await writeFile(vanishing, `${dshSessionText('van', 'hi', home)}\n`)

    const unreadable = join(home, 'unreadable/session.v4.jsonl')
    await mkdir(dirname(unreadable), { recursive: true })
    await writeFile(unreadable, `${dshSessionText('unr', 'hi', home)}\n`)

    const formatPath = join(home, 'future/session.v9.jsonl')
    const dshRefusal = Object.assign(new Error(`unsupported v9 with ${SECRET_TOKEN} (raw log: ${formatPath})`), {
      name: 'SessionFormatUnsupportedError',
      location: { kind: 'jsonl', path: formatPath },
    })

    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const fsWithUnreadable: EstelaCore['platform']['fs'] = {
      ...baseFs,
      read(path, range) {
        if (path === unreadable) {
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => Promise.reject(new Error(`EACCES: permission denied, open '${unreadable}'`)),
            }),
          }
        }
        return baseFs.read(path, range)
      },
    }

    const harness = createFakeHostContext({
      stat: async id => {
        if (id === 'no-log') {
          return {}
        }
        if (id === 'kit-unknown') {
          return { location: { kind: 'jsonl', path: unknownCopy } }
        }
        if (id === 'dsh-unknown') {
          throw dshRefusal
        }
        if (id === 'vanish') {
          return { location: { kind: 'jsonl', path: vanishing } }
        }
        if (id === 'unreadable') {
          return { location: { kind: 'jsonl', path: unreadable } }
        }
        return undefined
      },
    })
    mountHost(harness.ctx, { platform: makePlatform(home, {}, fsWithUnreadable) })

    const noLog = await harness.call('session/open', { sessionId: 'no-log' })
    expect(noLog.ok).toBe(false)
    if (!noLog.ok) {
      expect(noLog.error.code).toBe('estela/no-log')
      expect(noLog.error.details).toEqual({})
      namesNeitherHome(noLog.error.message, home)
    }

    const openedKit = await harness.call('session/open', { sessionId: 'kit-unknown' })
    expect(openedKit.ok).toBe(true)
    if (openedKit.ok) {
      const view = await harness.call('trace/view', openedKit.value)
      expect(view.ok).toBe(false)
      if (!view.ok) {
        expect(view.error.code).toBe('estela/failed')
        expect(view.error.message).toMatch(/^dsh: .+:1: unknown format generation/)
        namesNeitherHome(view.error.message, home)
      }
    }

    const dshUnknown = await harness.call('session/open', { sessionId: 'dsh-unknown' })
    expect(dshUnknown.ok).toBe(false)
    if (!dshUnknown.ok) {
      expect(dshUnknown.error.code).toBe('estela/failed')
      expect(dshUnknown.error.message).toMatch(/^dsh: .+:1: unknown format generation: /)
      expect(dshUnknown.error.message).not.toContain(SECRET_TOKEN)
      namesNeitherHome(dshUnknown.error.message, home)
    }

    const openedVanish = await harness.call('session/open', { sessionId: 'vanish' })
    expect(openedVanish.ok).toBe(true)
    await rm(vanishing)
    if (openedVanish.ok) {
      const view = await harness.call('trace/view', openedVanish.value)
      expect(view).toEqual({
        ok: false,
        error: { code: 'estela/failed', message: FIXED_FAILURE_MESSAGE, details: {} },
      })
    }

    const openedUnreadable = await harness.call('session/open', { sessionId: 'unreadable' })
    expect(openedUnreadable.ok).toBe(true)
    if (openedUnreadable.ok) {
      const view = await harness.call('trace/view', openedUnreadable.value)
      expect(view.ok).toBe(false)
      if (!view.ok) {
        expect(view.error.code).toBe('estela/failed')
        expect(view.error.details).toEqual({})
        namesNeitherHome(view.error.message, home)
      }
    }
  })

  it('refuses stale evicted trace/event calls without reading the file and allows reopening (DSH-9)', async () => {
    const home = await makeTempHome()
    const files: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const dir = join(home, `stale-${index}`)
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'session.v4.jsonl')
      await writeFile(file, `${dshSessionText(`st-${index}`, `initial ${index}`, home)}\n`)
      files.push(file)
    }

    const readsForFile0: string[] = []
    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const trackedFs: EstelaCore['platform']['fs'] = {
      ...baseFs,
      read: (path, options) => {
        if (path === files[0]) {
          readsForFile0.push(path)
        }
        return baseFs.read(path, options)
      },
    }

    const harness = createFakeHostContext({
      stat: async id => {
        const file = files[Number(id)]
        return file ? { location: { kind: 'jsonl', path: file } } : undefined
      },
    })
    mountHost(harness.ctx, { platform: makePlatform(home, {}, trackedFs) })

    let id0 = ''
    let eventId0 = ''
    for (let index = 0; index < 4; index += 1) {
      const opened = await harness.call('session/open', { sessionId: String(index) })
      expect(opened.ok).toBe(true)
      if (!opened.ok) {
        return
      }
      const { traceId } = z.parse(openValueSchema, opened.value)
      const view = await harness.call('trace/view', { traceId })
      expect(view.ok).toBe(true)
      if (index === 0 && view.ok) {
        id0 = traceId
        eventId0 = z.parse(viewValueSchema, view.value).trace.events[0]!.id
      }
    }

    readsForFile0.length = 0
    await writeFile(files[0]!, `${dshSessionText('st-0', 'updated after eviction', home)}\n`)
    const bumped = new Date(Date.now() + 5000)
    await utimes(files[0]!, bumped, bumped)

    const stale = await harness.call('trace/event', { traceId: id0, id: eventId0 })
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.error.code).toBe('estela/stale')
      expect(stale.error.details).toEqual({})
    }
    expect(readsForFile0).toEqual([])

    const retryOld = await harness.call('trace/event', { traceId: id0, id: eventId0 })
    expect(retryOld.ok).toBe(false)
    if (!retryOld.ok) {
      expect(retryOld.error.code).toBe('estela/unknown-trace')
    }

    const reopened = await harness.call('session/open', { sessionId: '0' })
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) {
      return
    }
    const { traceId: nextTraceId } = z.parse(openValueSchema, reopened.value)
    expect(nextTraceId).not.toBe(id0)
    const nextView = await harness.call('trace/view', { traceId: nextTraceId })
    expect(nextView.ok).toBe(true)
    if (nextView.ok) {
      expect(JSON.stringify(nextView.value)).toContain('updated after eviction')
    }
  })
})
