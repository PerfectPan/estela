import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import type { LoadHandle } from '@rivus/estela-rpc/trace-store'
import { createEstelaCore, type EstelaCore } from '@rivus/estela-server/core'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import * as z from 'zod/mini'
import { createChannelHost } from './channel.ts'
import { apply, mountHost } from './index.ts'
import type { EffectDisposer, HostContext, HostPeer, HostSessionPersistence, RpcHandler } from './rpc.ts'
import { createSessionRegistry } from './sessions.ts'

const FAKE_USER = 'fake-dsh-user-carol'
const SECRET_TOKEN = 'sk-abcdefghijklmnop'
const processHome = homedir()
const ownerPeer: HostPeer = { principal: { kind: 'owner' } }
const openValueSchema = z.object({ traceId: z.string() })
const dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-'))
  dirs.push(root)
  const home = join(root, FAKE_USER)
  await mkdir(home, { recursive: true })
  return home
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

function makePlatform(home: string, env: Record<string, string> = {}) {
  const base = createEstelaCore({ redacts: false }).platform
  return { ...base, home, env }
}

function createFakeHostContext(persistence: HostSessionPersistence) {
  let handler: RpcHandler | undefined
  const disposers: EffectDisposer[] = []

  class FakeConnection {
    get rpc() {
      return {
        handle: (_channel: string, fn: RpcHandler) => {
          handler = fn
          return () => {}
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
    call(endpoint: string, payload: unknown) {
      if (!handler) {
        throw new Error('channel handler was not registered')
      }
      return handler(endpoint, payload, new AbortController().signal, ownerPeer)
    },
    async dispose() {
      for (const cleanup of disposers.splice(0)) {
        await cleanup()
      }
    },
  }
}

describe('dsh host redaction, holds, signal abort, and dispose', () => {
  it('redacts by default and disables redaction only when ESTELA_REDACT=0 (DSH-10)', async () => {
    const home = await makeTempHome()
    const file = join(home, 'session.v4.jsonl')
    await writeFile(file, `${dshSessionText('sec', `Read ${join(home, 'notes.md')} with ${SECRET_TOKEN}`, home)}\n`)

    const persistence: HostSessionPersistence = {
      stat: async () => ({ location: { kind: 'jsonl', path: file } }),
    }

    const redactedHarness = createFakeHostContext(persistence)
    mountHost(redactedHarness.ctx, { platform: makePlatform(home, {}) })
    const openRedacted = await redactedHarness.call('session/open', { sessionId: 'sec' })
    expect(openRedacted.ok).toBe(true)
    if (openRedacted.ok) {
      const view = await redactedHarness.call('trace/view', openRedacted.value)
      expect(view.ok).toBe(true)
      if (view.ok) {
        const serialized = JSON.stringify(view.value)
        for (const needle of [home, JSON.stringify(home).slice(1, -1), processHome, FAKE_USER, SECRET_TOKEN]) {
          expect(serialized).not.toContain(needle)
        }
      }
    }
    await redactedHarness.dispose()

    const previousEnv = process.env.ESTELA_REDACT
    process.env.ESTELA_REDACT = '0'
    try {
      const rawHarness = createFakeHostContext(persistence)
      apply(rawHarness.ctx)
      const openRaw = await rawHarness.call('session/open', { sessionId: 'sec' })
      expect(openRaw.ok).toBe(true)
      if (openRaw.ok) {
        const view = await rawHarness.call('trace/view', openRaw.value)
        expect(view.ok).toBe(true)
        if (view.ok) {
          expect(JSON.stringify(view.value)).toContain(SECRET_TOKEN)
        }
      }
      await rawHarness.dispose()
    } finally {
      if (previousEnv === undefined) {
        delete process.env.ESTELA_REDACT
      } else {
        process.env.ESTELA_REDACT = previousEnv
      }
    }
  })

  it('releases holds on signal abort and aborts the load only when the last holder releases', async () => {
    const home = await makeTempHome()
    const file = join(home, 'session.v4.jsonl')
    await writeFile(file, `${dshSessionText('slow', 'hello', home)}\n`)

    const persistence: HostSessionPersistence = {
      stat: async () => ({ location: { kind: 'jsonl', path: file } }),
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = createEstelaCore({ platform: makePlatform(home), redacts: true, resolve: id => registry.resolve(id) })
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })

    let releaseCount = 0
    let holders = 0
    let loadAborted = false
    let loadDoneResolve!: () => void
    let loadDoneReject!: (error: Error) => void
    const loadDone = new Promise<void>((resolve, reject) => {
      loadDoneResolve = resolve
      loadDoneReject = reject
    })
    loadDone.catch(() => {})

    const openSpy = vi.spyOn(core.store, 'open').mockImplementation(async traceId => {
      holders += 1
      let released = false
      const handle: LoadHandle = {
        cached: false,
        progress: () => ({ bytesRead: 0, totalBytes: 10 }),
        onProgress: () => () => {},
        done: loadDone,
        release: () => {
          if (released) {
            return
          }
          released = true
          releaseCount += 1
          holders -= 1
          if (holders === 0) {
            loadAborted = true
            const err = new Error(`load of ${traceId} was cancelled`)
            err.name = 'LoadCancelledError'
            loadDoneReject(err)
          }
        },
      }
      return handle
    })

    const channel = createChannelHost({ core, sessions: registry })
    const opened = await channel.handler('session/open', { sessionId: 'slow' }, new AbortController().signal, ownerPeer)
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }
    const { traceId } = z.parse(openValueSchema, opened.value)

    // Two concurrent trace/view calls share the load without an owner: aborting one leaves the other running.
    const ac1 = new AbortController()
    const ac2 = new AbortController()
    const call1 = channel.handler('trace/view', { traceId }, ac1.signal, ownerPeer)
    const call2 = channel.handler('trace/view', { traceId }, ac2.signal, ownerPeer)

    await vi.waitFor(() => {
      expect(channel.activeHoldCount()).toBe(2)
    })
    // T9: trace/view takes holds with no owner so one tab never supersedes another.
    expect(openSpy).toHaveBeenNthCalledWith(1, traceId)
    expect(openSpy).toHaveBeenNthCalledWith(2, traceId)

    ac1.abort()
    expect(releaseCount).toBe(1)
    expect(loadAborted).toBe(false)
    expect(channel.activeHoldCount()).toBe(1)

    loadDoneResolve()
    const res2 = await call2
    expect(res2.ok).toBe(true)
    expect(channel.activeHoldCount()).toBe(0)
    await call1

    // Single holder abort immediately releases its hold and aborts the load.
    releaseCount = 0
    holders = 0
    loadAborted = false
    const acSingle = new AbortController()
    let singleReject!: (err: Error) => void
    const singleDone = new Promise<void>((_, reject) => {
      singleReject = reject
    })
    singleDone.catch(() => {})
    vi.spyOn(core.store, 'open').mockImplementationOnce(async traceIdArg => {
      holders += 1
      let released = false
      return {
        cached: false,
        progress: () => ({ bytesRead: 0, totalBytes: 10 }),
        onProgress: () => () => {},
        done: singleDone,
        release: () => {
          if (released) {
            return
          }
          released = true
          releaseCount += 1
          holders -= 1
          if (holders === 0) {
            loadAborted = true
            const err = new Error(`load of ${traceIdArg} was cancelled`)
            err.name = 'LoadCancelledError'
            singleReject(err)
          }
        },
      }
    })

    await writeFile(file, `${dshSessionText('slow', 'hello 2', home)}\n`)
    const bumped = new Date(Date.now() + 5000)
    await utimes(file, bumped, bumped)
    const opened2 = await channel.handler(
      'session/open',
      { sessionId: 'slow' },
      new AbortController().signal,
      ownerPeer,
    )
    expect(opened2.ok).toBe(true)
    if (!opened2.ok) {
      return
    }
    const singleCall = channel.handler('trace/view', opened2.value, acSingle.signal, ownerPeer)
    await vi.waitFor(() => {
      expect(channel.activeHoldCount()).toBe(1)
    })
    acSingle.abort()
    expect(releaseCount).toBe(1)
    expect(loadAborted).toBe(true)
    const singleRes = await singleCall
    expect(singleRes.ok).toBe(false)
    expect(channel.activeHoldCount()).toBe(0)
  })

  it('aborts an unmocked TraceStore load when signal fires mid-read and caches nothing', async () => {
    const home = await makeTempHome()
    const file = join(home, 'session.v4.jsonl')
    await writeFile(file, `${dshSessionText('real-abort', 'hello', home)}\n`)

    let releaseChunk!: () => void
    const chunkGate = new Promise<void>(resolve => {
      releaseChunk = resolve
    })
    let streamStarted!: () => void
    const started = new Promise<void>(resolve => {
      streamStarted = resolve
    })

    const base = createEstelaCore({ redacts: false }).platform
    let chunksServed = 0
    const gatedFs: EstelaCore['platform']['fs'] = {
      ...base.fs,
      read(path, range) {
        if (path !== file) {
          return base.fs.read(path, range)
        }
        const inner = base.fs.read(path, range)[Symbol.asyncIterator]()
        return {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                chunksServed += 1
                if (chunksServed === 1) {
                  streamStarted()
                  await chunkGate
                }
                return inner.next()
              },
            }
          },
        }
      },
    }

    let registry!: ReturnType<typeof createSessionRegistry>
    const core = createEstelaCore({
      platform: { ...base, home, env: {}, fs: gatedFs },
      redacts: true,
      resolve: id => registry.resolve(id),
    })
    registry = createSessionRegistry({
      persistence: { stat: async () => ({ location: { kind: 'jsonl', path: file } }) },
      fs: core.platform.fs,
      store: core.store,
      redact: core.redact,
    })

    const channel = createChannelHost({ core, sessions: registry })
    const opened = await channel.handler(
      'session/open',
      { sessionId: 'real-abort' },
      new AbortController().signal,
      ownerPeer,
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }

    const controller = new AbortController()
    const inFlight = channel.handler('trace/view', opened.value, controller.signal, ownerPeer)
    await started
    controller.abort()
    releaseChunk()

    const result = await inFlight
    expect(result.ok).toBe(false)
    expect(channel.activeHoldCount()).toBe(0)
    expect(core.store.cachedKeys()).toEqual([])
  })

  it('ends in-flight calls with estela/closed on dispose, releases all holds, clears ids, and blocks further store calls', async () => {
    const home = await makeTempHome()
    const file = join(home, 'session.v4.jsonl')
    await writeFile(file, `${dshSessionText('disp', 'hello', home)}\n`)

    const persistence: HostSessionPersistence = {
      stat: async () => ({ location: { kind: 'jsonl', path: file } }),
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = createEstelaCore({ platform: makePlatform(home), redacts: true, resolve: id => registry.resolve(id) })
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })

    let holdReleased = false
    const neverDone = new Promise<void>(() => {})
    const openSpy = vi.spyOn(core.store, 'open').mockImplementation(async () => ({
      cached: false,
      progress: () => ({ bytesRead: 0, totalBytes: 10 }),
      onProgress: () => () => {},
      done: neverDone,
      release: () => {
        holdReleased = true
      },
    }))
    const viewSpy = vi.spyOn(core.store, 'view')
    const eventSpy = vi.spyOn(core.store, 'event')

    const channel = createChannelHost({ core, sessions: registry })
    const signal = new AbortController().signal
    const opened = await channel.handler('session/open', { sessionId: 'disp' }, signal, ownerPeer)
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }
    const { traceId } = z.parse(openValueSchema, opened.value)

    const inFlight = channel.handler('trace/view', { traceId }, signal, ownerPeer)
    await vi.waitFor(() => {
      expect(channel.activeHoldCount()).toBe(1)
    })

    channel.dispose()

    const closedRes = await inFlight
    expect(closedRes).toEqual({
      ok: false,
      error: { code: 'estela/closed', message: 'the plugin is closed', details: {} },
    })
    expect(holdReleased).toBe(true)
    expect(channel.activeHoldCount()).toBe(0)
    expect(registry.resolve(traceId)).toBeUndefined()

    openSpy.mockClear()
    viewSpy.mockClear()
    eventSpy.mockClear()
    for (const res of [
      await channel.handler('session/open', { sessionId: 'disp' }, signal, ownerPeer),
      await channel.handler('trace/view', { traceId }, signal, ownerPeer),
      await channel.handler('trace/event', { traceId, id: 'e1' }, signal, ownerPeer),
    ]) {
      expect(res).toEqual({
        ok: false,
        error: { code: 'estela/closed', message: 'the plugin is closed', details: {} },
      })
    }
    expect(openSpy).not.toHaveBeenCalled()
    expect(viewSpy).not.toHaveBeenCalled()
    expect(eventSpy).not.toHaveBeenCalled()
  })
})
