import { appendFile, cp, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { createEstelaCore, type EstelaCore } from '@rivus/estela-server/core'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import * as z from 'zod/mini'
import { createChannelHost } from './channel.ts'
import type { HostPeer, HostSessionPersistence } from './rpc.ts'
import { createSessionRegistry } from './sessions.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const plainFixture = join(repo, 'fixtures/sessions/dsh/conformance/plain/session.v4.jsonl')

const ownerPeer: HostPeer = { principal: { kind: 'owner' } }
const openSchema = z.object({ traceId: z.string() })
const viewSchema = z.object({
  traceId: z.string(),
  trace: z.object({ events: z.array(z.object({ id: z.string(), payload: z.unknown() })) }),
})

const dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-races-'))
  dirs.push(root)
  const home = join(root, 'fake-user-races')
  await mkdir(home, { recursive: true })
  return home
}

function dshSession(id: string, messages: readonly string[], cwd: string): string {
  const lines = [JSON.stringify({ type: 'session', version: 4, id, createdAt: 1767225600000, cwd })]
  messages.forEach((text, index) => {
    lines.push(
      JSON.stringify({
        type: 'user/message',
        seq: index + 1,
        time: 1767225601000 + index * 1000,
        data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' }, id: `u-${id}-${index}` },
      }),
    )
  })
  return `${lines.join('\n')}\n`
}

function buildCore(
  home: string,
  resolve: (id: string) => ReturnType<ReturnType<typeof createSessionRegistry>['resolve']>,
  fs?: EstelaCore['platform']['fs'],
) {
  const base = createEstelaCore({ redacts: false }).platform
  return createEstelaCore({
    platform: { ...base, home, env: {}, ...(fs ? { fs } : {}) },
    redacts: true,
    resolve,
  })
}

describe('DSH-9 TraceStore stamp invariant and cached edge cases', () => {
  it('cached-read-race: returns estela/stale when a cached zstd file is rewritten same-size between stat and read', async () => {
    const home = await makeTempHome()
    const dir = join(home, 'zstd-race')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'session.v4.jsonl.zstd')
    const initialJsonl = dshSession('zr', ['hello'], home)
    const replacedJsonl = dshSession('zr', ['world'], home)
    await writeFile(file, zstdCompressSync(Buffer.from(initialJsonl, 'utf8')))

    let rewriteOnRead = false
    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const racingFs: EstelaCore['platform']['fs'] = {
      ...baseFs,
      read(path, range) {
        if (rewriteOnRead && path === file) {
          rewriteOnRead = false
          return {
            [Symbol.asyncIterator]() {
              let inner: AsyncIterator<Uint8Array> | undefined
              return {
                async next() {
                  if (!inner) {
                    // Rewrite hello -> world AFTER checkedOriginal's initial stat and BEFORE reading bytes.
                    await writeFile(file, zstdCompressSync(Buffer.from(replacedJsonl, 'utf8')))
                    const bumped = new Date(Date.now() + 5000)
                    await utimes(file, bumped, bumped)
                    inner = baseFs.read(path, range)[Symbol.asyncIterator]()
                  }
                  return inner.next()
                },
              }
            },
          }
        }
        return baseFs.read(path, range)
      },
    }

    const persistence: HostSessionPersistence = {
      stat: async () => ({ location: { kind: 'jsonl', path: file } }),
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id), racingFs)
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })
    const channel = createChannelHost({ core, sessions: registry })
    const signal = new AbortController().signal

    const opened = await channel.handler('session/open', { sessionId: 'zr' }, signal, ownerPeer)
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }
    const { traceId } = z.parse(openSchema, opened.value)
    const view = await channel.handler('trace/view', { traceId }, signal, ownerPeer)
    expect(view.ok).toBe(true)
    if (!view.ok) {
      return
    }
    const eventId = z.parse(viewSchema, view.value).trace.events[0]!.id
    expect(core.store.cachedKeys()).toContain(traceId)

    rewriteOnRead = true
    const raced = await channel.handler('trace/event', { traceId, id: eventId }, signal, ownerPeer)
    expect(raced.ok).toBe(false)
    if (!raced.ok) {
      expect(raced.error.code).toBe('estela/stale')
    }
    expect(registry.resolve(traceId)).toBeUndefined()
  })

  it('concurrent-event: both overlapping waiters on an evicted rewritten log get estela/stale and nothing is cached', async () => {
    const home = await makeTempHome()
    const files: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const dir = join(home, `conc-${index}`)
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'session.v4.jsonl')
      await writeFile(file, dshSession(`conc-${index}`, [index === 0 ? 'hello' : `other ${index}`], home))
      files.push(file)
    }

    let holdNextRead = false
    let readStarted!: () => void
    const started = new Promise<void>(resolve => {
      readStarted = resolve
    })
    let releaseRead!: () => void
    const readGate = new Promise<void>(resolve => {
      releaseRead = resolve
    })

    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const gatedFs: EstelaCore['platform']['fs'] = {
      ...baseFs,
      read(path, range) {
        if (holdNextRead && path === files[0]) {
          holdNextRead = false
          return {
            [Symbol.asyncIterator]() {
              let inner: AsyncIterator<Uint8Array> | undefined
              return {
                async next() {
                  if (!inner) {
                    readStarted()
                    await readGate
                    inner = baseFs.read(path, range)[Symbol.asyncIterator]()
                  }
                  return inner.next()
                },
              }
            },
          }
        }
        return baseFs.read(path, range)
      },
    }

    const persistence: HostSessionPersistence = {
      stat: async id => {
        const file = files[Number(id)]
        return file ? { location: { kind: 'jsonl', path: file } } : undefined
      },
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id), gatedFs)
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })
    const channel = createChannelHost({ core, sessions: registry })
    const signal = new AbortController().signal

    let idA = ''
    let eventIdA = ''
    for (let index = 0; index < 4; index += 1) {
      const opened = await channel.handler('session/open', { sessionId: String(index) }, signal, ownerPeer)
      expect(opened.ok).toBe(true)
      if (!opened.ok) {
        return
      }
      const { traceId } = z.parse(openSchema, opened.value)
      const view = await channel.handler('trace/view', { traceId }, signal, ownerPeer)
      expect(view.ok).toBe(true)
      if (index === 0 && view.ok) {
        idA = traceId
        eventIdA = z.parse(viewSchema, view.value).trace.events[0]!.id
      }
    }
    expect(core.store.cachedKeys()).not.toContain(idA)

    holdNextRead = true
    const first = channel.handler('trace/event', { traceId: idA, id: eventIdA }, signal, ownerPeer)
    await started
    // Second call enters while first reload is in flight, before the file is rewritten.
    const second = channel.handler('trace/event', { traceId: idA, id: eventIdA }, signal, ownerPeer)
    await new Promise<void>(resolve => setTimeout(resolve, 10))

    await writeFile(files[0]!, dshSession('conc-0', ['replacement message'], home))
    const bumped = new Date(Date.now() + 5000)
    await utimes(files[0]!, bumped, bumped)
    releaseRead()

    const [res1, res2] = await Promise.all([first, second])
    expect(res1.ok).toBe(false)
    expect(res2.ok).toBe(false)
    if (!res1.ok && !res2.ok) {
      expect(res1.error.code).toBe('estela/stale')
      expect(res2.error.code).toBe('estela/stale')
    }
    expect(core.store.cachedKeys()).not.toContain(idA)
    expect(registry.resolve(idA)).toBeUndefined()
  })

  it('aborted-reload: cancelling a cold reload on a rewritten log never leaves rewritten content cached for a later caller', async () => {
    const home = await makeTempHome()
    const files: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const dir = join(home, `abort-${index}`)
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'session.v4.jsonl')
      await writeFile(file, dshSession(`ab-${index}`, [index === 0 ? 'hello' : `other ${index}`], home))
      files.push(file)
    }

    let holdNextRead = false
    let readStarted!: () => void
    const started = new Promise<void>(resolve => {
      readStarted = resolve
    })
    let releaseRead!: () => void
    const readGate = new Promise<void>(resolve => {
      releaseRead = resolve
    })

    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const gatedFs: EstelaCore['platform']['fs'] = {
      ...baseFs,
      read(path, range) {
        if (holdNextRead && path === files[0]) {
          holdNextRead = false
          return {
            [Symbol.asyncIterator]() {
              let inner: AsyncIterator<Uint8Array> | undefined
              return {
                async next() {
                  if (!inner) {
                    readStarted()
                    await readGate
                    inner = baseFs.read(path, range)[Symbol.asyncIterator]()
                  }
                  return inner.next()
                },
              }
            },
          }
        }
        return baseFs.read(path, range)
      },
    }

    const persistence: HostSessionPersistence = {
      stat: async id => {
        const file = files[Number(id)]
        return file ? { location: { kind: 'jsonl', path: file } } : undefined
      },
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id), gatedFs)
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })
    const channel = createChannelHost({ core, sessions: registry })
    const signal = new AbortController().signal

    let idA = ''
    let eventIdA = ''
    for (let index = 0; index < 4; index += 1) {
      const opened = await channel.handler('session/open', { sessionId: String(index) }, signal, ownerPeer)
      expect(opened.ok).toBe(true)
      if (!opened.ok) {
        return
      }
      const { traceId } = z.parse(openSchema, opened.value)
      const view = await channel.handler('trace/view', { traceId }, signal, ownerPeer)
      expect(view.ok).toBe(true)
      if (index === 0 && view.ok) {
        idA = traceId
        eventIdA = z.parse(viewSchema, view.value).trace.events[0]!.id
      }
    }

    holdNextRead = true
    const ac = new AbortController()
    const realView = core.store.view.bind(core.store)
    vi.spyOn(core.store, 'view').mockImplementation(async id => {
      // If a buggy store cached the rewritten file and reached store.view, cancel here as Codex's aborted-reload did.
      if (id === idA) {
        ac.abort()
      }
      return realView(id)
    })

    const cancelledCall = channel.handler('trace/view', { traceId: idA }, ac.signal, ownerPeer)
    await started
    await writeFile(files[0]!, dshSession('ab-0', ['replacement message'], home))
    const bumped = new Date(Date.now() + 5000)
    await utimes(files[0]!, bumped, bumped)
    releaseRead()

    const cancelled = await cancelledCall
    expect(cancelled.ok).toBe(false)
    expect(core.store.cachedKeys()).not.toContain(idA)

    const followUp = await channel.handler('trace/event', { traceId: idA, id: eventIdA }, signal, ownerPeer)
    expect(followUp.ok).toBe(false)
    if (!followUp.ok) {
      expect(['estela/stale', 'estela/unknown-trace']).toContain(followUp.error.code)
    }
    expect(core.store.cachedKeys()).not.toContain(idA)
  })

  it('cached-eviction: a view that starts on a cached id returns estela/stale if evicted and appended before store.view runs', async () => {
    const home = await makeTempHome()
    const files: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const dir = join(home, `evview-${index}`)
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'session.v4.jsonl')
      if (index === 0) {
        await cp(plainFixture, file)
      } else {
        await writeFile(file, dshSession(`evview-${index}`, [`other ${index}`], home))
      }
      files.push(file)
    }

    const persistence: HostSessionPersistence = {
      stat: async id => {
        const file = files[Number(id)]
        return file ? { location: { kind: 'jsonl', path: file } } : undefined
      },
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id))
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })
    const channel = createChannelHost({ core, sessions: registry })
    const signal = new AbortController().signal

    const openedA = await channel.handler('session/open', { sessionId: '0' }, signal, ownerPeer)
    expect(openedA.ok).toBe(true)
    if (!openedA.ok) {
      return
    }
    const idA = z.parse(openSchema, openedA.value).traceId
    const initialView = await channel.handler('trace/view', { traceId: idA }, signal, ownerPeer)
    expect(initialView.ok).toBe(true)
    expect(core.store.cachedKeys()).toContain(idA)

    // Pause trace/view(idA) right after store.open returns the cached handle, before store.view runs.
    let gateResolve!: () => void
    const gate = new Promise<void>(resolve => {
      gateResolve = resolve
    })
    let pausedAtOpen!: () => void
    const atOpen = new Promise<void>(resolve => {
      pausedAtOpen = resolve
    })
    const realOpen = core.store.open.bind(core.store)
    vi.spyOn(core.store, 'open').mockImplementationOnce(async traceId => {
      const handle = await realOpen(traceId)
      pausedAtOpen()
      return { ...handle, done: gate }
    })

    const secondViewCall = channel.handler('trace/view', { traceId: idA }, signal, ownerPeer)
    await atOpen

    // Evict A with B, C, D and append a new message to A's file before releasing the paused view.
    for (let index = 1; index < 4; index += 1) {
      const opened = await channel.handler('session/open', { sessionId: String(index) }, signal, ownerPeer)
      expect(opened.ok).toBe(true)
      if (opened.ok) {
        await channel.handler('trace/view', opened.value, signal, ownerPeer)
      }
    }
    expect(core.store.cachedKeys()).not.toContain(idA)

    await appendFile(
      files[0]!,
      `${JSON.stringify({
        type: 'user/message',
        seq: 9,
        time: 1767225609000,
        data: {
          role: 'user',
          content: [{ type: 'text', text: 'appended after eviction' }],
          source: { kind: 'user' },
          id: 'u-appended',
        },
      })}\n`,
    )
    const bumped = new Date(Date.now() + 5000)
    await utimes(files[0]!, bumped, bumped)

    gateResolve()
    const secondView = await secondViewCall
    expect(secondView.ok).toBe(false)
    if (!secondView.ok) {
      expect(secondView.error.code).toBe('estela/stale')
    }
    expect(core.store.cachedKeys()).not.toContain(idA)
    expect(registry.resolve(idA)).toBeUndefined()
  })
})
