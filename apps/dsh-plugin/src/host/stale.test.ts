import { appendFile, cp, mkdir, mkdtemp, rename, rm, utimes, writeFile } from 'node:fs/promises'
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
const zstdFixture = join(repo, 'fixtures/sessions/dsh/conformance/plain/session.v4.jsonl.zstd')

const ownerPeer: HostPeer = { principal: { kind: 'owner' } }
const openSchema = z.object({ traceId: z.string() })
const viewSchema = z.object({
  traceId: z.string(),
  trace: z.object({ events: z.array(z.object({ id: z.string(), payload: z.unknown() })) }),
})
const eventSchema = z.object({
  id: z.string(),
  original: z.optional(z.unknown()),
  originalUnavailable: z.optional(z.string()),
})

const dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-stale-'))
  dirs.push(root)
  const home = join(root, 'fake-user-stale')
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

describe('DSH-9 stale snapshot guarantees', () => {
  it('returns estela/stale and drops the id when a cold-cache file is rewritten between readiness stat and store read', async () => {
    const home = await makeTempHome()
    const files: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const dir = join(home, `race-${index}`)
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'session.v4.jsonl')
      await writeFile(file, dshSession(`race-${index}`, [index === 0 ? 'hello' : `other ${index}`], home))
      files.push(file)
    }

    let rewriteOnNextRead = false
    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const racingFs: EstelaCore['platform']['fs'] = {
      ...baseFs,
      read(path, range) {
        if (rewriteOnNextRead && path === files[0]) {
          rewriteOnNextRead = false
          return {
            [Symbol.asyncIterator]() {
              let inner: AsyncIterator<Uint8Array> | undefined
              return {
                async next() {
                  if (!inner) {
                    // Rewrite the file AFTER checkReady's stat succeeded and BEFORE store reads it.
                    await writeFile(files[0]!, dshSession('race-0', ['replacement message'], home))
                    const bumped = new Date(Date.now() + 5000)
                    await utimes(files[0]!, bumped, bumped)
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
    const core = buildCore(home, id => registry.resolve(id), racingFs)
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })
    const channel = createChannelHost({ core, sessions: registry })
    const signal = new AbortController().signal

    // Load A, then B/C/D to evict A from TraceStore's 3-slot cache.
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

    // Arm the rewrite between readiness stat and store read, then request A's event under the old id.
    rewriteOnNextRead = true
    const raced = await channel.handler('trace/event', { traceId: idA, id: eventIdA }, signal, ownerPeer)
    expect(raced.ok).toBe(false)
    if (!raced.ok) {
      expect(raced.error.code).toBe('estela/stale')
      expect(raced.error.details).toEqual({})
    }
    expect(registry.resolve(idA)).toBeUndefined()

    // Old id is dropped; reopening yields a new id that reads the replacement content.
    const retry = await channel.handler('trace/event', { traceId: idA, id: eventIdA }, signal, ownerPeer)
    expect(retry.ok).toBe(false)
    if (!retry.ok) {
      expect(retry.error.code).toBe('estela/unknown-trace')
    }

    const reopened = await channel.handler('session/open', { sessionId: '0' }, signal, ownerPeer)
    expect(reopened.ok).toBe(true)
    if (reopened.ok) {
      const nextId = z.parse(openSchema, reopened.value).traceId
      expect(nextId).not.toBe(idA)
      const nextView = await channel.handler('trace/view', { traceId: nextId }, signal, ownerPeer)
      expect(nextView.ok).toBe(true)
      if (nextView.ok) {
        expect(JSON.stringify(nextView.value)).toContain('replacement message')
      }
    }
  })

  it('returns estela/stale when a cached event original disappears after rewrite, keeps appended snapshots readable, and preserves unchanged originalUnavailable', async () => {
    const home = await makeTempHome()
    const dir = join(home, 'cached-rewrite')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'session.v4.jsonl')
    await writeFile(file, dshSession('cw', ['first turn', 'second turn'], home))

    const persistence: HostSessionPersistence = {
      stat: async () => ({ location: { kind: 'jsonl', path: file } }),
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id))
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })
    const channel = createChannelHost({ core, sessions: registry })
    const signal = new AbortController().signal

    const opened = await channel.handler('session/open', { sessionId: 'cw' }, signal, ownerPeer)
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }
    const { traceId } = z.parse(openSchema, opened.value)
    const viewRes = await channel.handler('trace/view', { traceId }, signal, ownerPeer)
    expect(viewRes.ok).toBe(true)
    if (!viewRes.ok) {
      return
    }
    const events = z.parse(viewSchema, viewRes.value).trace.events
    expect(events).toHaveLength(2)
    const firstEventId = events[0]!.id
    const secondEventId = events[1]!.id

    // 1. Before mutation, cached trace/event reads the original record.
    const before = await channel.handler('trace/event', { traceId, id: secondEventId }, signal, ownerPeer)
    expect(before.ok).toBe(true)
    if (before.ok) {
      const detail = z.parse(eventSchema, before.value)
      expect(detail.original).toBeDefined()
      expect(detail.originalUnavailable).toBeUndefined()
    }

    // 2. Normal append on plain jsonl: old events stay readable on the existing cached snapshot.
    await writeFile(file, dshSession('cw', ['first turn', 'second turn', 'third appended turn'], home))
    const bumpedAppend = new Date(Date.now() + 3000)
    await utimes(file, bumpedAppend, bumpedAppend)
    const afterAppend = await channel.handler('trace/event', { traceId, id: secondEventId }, signal, ownerPeer)
    expect(afterAppend.ok).toBe(true)
    if (afterAppend.ok) {
      const detail = z.parse(eventSchema, afterAppend.value)
      expect(detail.original).toBeDefined()
      expect(detail.originalUnavailable).toBeUndefined()
    }

    // 3. Rewrite to a shorter valid log so the second event's original is gone while still cached:
    //    must answer estela/stale and drop the id instead of returning ok:true + originalUnavailable.
    await writeFile(file, dshSession('cw', ['first turn'], home))
    const bumpedRewrite = new Date(Date.now() + 6000)
    await utimes(file, bumpedRewrite, bumpedRewrite)
    expect(core.store.cachedKeys()).toContain(traceId)

    const afterRewrite = await channel.handler('trace/event', { traceId, id: secondEventId }, signal, ownerPeer)
    expect(afterRewrite.ok).toBe(false)
    if (!afterRewrite.ok) {
      expect(afterRewrite.error.code).toBe('estela/stale')
      expect(afterRewrite.error.details).toEqual({})
    }
    expect(registry.resolve(traceId)).toBeUndefined()

    // 4. Reopen the shortened log: when store.event reports originalUnavailable on an UNCHANGED file,
    //    host must preserve ok:true + originalUnavailable and keep the id valid.
    const reopened = await channel.handler('session/open', { sessionId: 'cw' }, signal, ownerPeer)
    expect(reopened.ok).toBe(true)
    if (!reopened.ok) {
      return
    }
    const nextId = z.parse(openSchema, reopened.value).traceId
    expect(nextId).not.toBe(traceId)
    const nextView = await channel.handler('trace/view', { traceId: nextId }, signal, ownerPeer)
    expect(nextView.ok).toBe(true)
    if (!nextView.ok) {
      return
    }
    const nextEventId = z.parse(viewSchema, nextView.value).trace.events[0]!.id
    const realEvent = await core.store.event(nextId, nextEventId)
    vi.spyOn(core.store, 'event').mockResolvedValueOnce({
      ...realEvent,
      original: undefined,
      originalUnavailable: 'corrupt record on disk',
    })

    const unchangedUnavailable = await channel.handler(
      'trace/event',
      { traceId: nextId, id: nextEventId },
      signal,
      ownerPeer,
    )
    expect(unchangedUnavailable.ok).toBe(true)
    if (unchangedUnavailable.ok) {
      const detail = z.parse(eventSchema, unchangedUnavailable.value)
      expect(detail.originalUnavailable).toBe('corrupt record on disk')
    }
    expect(registry.resolve(nextId)).toBeDefined()
    expect(firstEventId).toBe(nextEventId)
  })

  it('relocated-file and zstd append: keeps old zstd events readable after frame append, and answers estela/stale when file relocates', async () => {
    const home = await makeTempHome()
    const oldDir = join(home, 'zstd-old')
    const newDir = join(home, 'zstd-new')
    await mkdir(oldDir, { recursive: true })
    await mkdir(newDir, { recursive: true })
    const oldFile = join(oldDir, 'session.v4.jsonl.zstd')
    const newFile = join(newDir, 'session.v4.jsonl.zstd')
    await cp(zstdFixture, oldFile)

    let currentPath = oldFile
    const persistence: HostSessionPersistence = {
      stat: async () => ({ location: { kind: 'jsonl', path: currentPath } }),
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id))
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })
    const channel = createChannelHost({ core, sessions: registry })
    const signal = new AbortController().signal

    const opened = await channel.handler('session/open', { sessionId: 'z1' }, signal, ownerPeer)
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
    const events = z.parse(viewSchema, view.value).trace.events
    const helloEvent = events.find(ev => JSON.stringify(ev.payload).includes('hello'))
    expect(helloEvent).toBeDefined()

    // 1. Append a valid zstd frame: old event must still read back with its original (with #183 in baseline).
    const appendedLine = `${JSON.stringify({
      type: 'user/message',
      seq: 9,
      time: 1767225609000,
      data: {
        role: 'user',
        content: [{ type: 'text', text: 'appended zstd frame' }],
        source: { kind: 'user' },
        id: 'u-z',
      },
    })}\n`
    await appendFile(oldFile, zstdCompressSync(Buffer.from(appendedLine, 'utf8')))
    const bumped = new Date(Date.now() + 3000)
    await utimes(oldFile, bumped, bumped)

    const afterZstdAppend = await channel.handler('trace/event', { traceId, id: helloEvent!.id }, signal, ownerPeer)
    expect(afterZstdAppend.ok).toBe(true)
    if (afterZstdAppend.ok) {
      const detail = z.parse(eventSchema, afterZstdAppend.value)
      expect(detail.original).toBeDefined()
      expect(detail.originalUnavailable).toBeUndefined()
    }

    // 2. Relocate the file to a new path and update persistence: old id must answer estela/stale and drop itself.
    await rename(oldFile, newFile)
    await writeFile(newFile, zstdCompressSync(Buffer.from(dshSession('z1', ['restored hello'], home), 'utf8')))
    currentPath = newFile

    const afterRelocate = await channel.handler('trace/event', { traceId, id: helloEvent!.id }, signal, ownerPeer)
    expect(afterRelocate.ok).toBe(false)
    if (!afterRelocate.ok) {
      expect(afterRelocate.error.code).toBe('estela/stale')
    }
    expect(registry.resolve(traceId)).toBeUndefined()

    const reopened = await channel.handler('session/open', { sessionId: 'z1' }, signal, ownerPeer)
    expect(reopened.ok).toBe(true)
    if (reopened.ok) {
      const nextId = z.parse(openSchema, reopened.value).traceId
      expect(nextId).not.toBe(traceId)
      const nextView = await channel.handler('trace/view', { traceId: nextId }, signal, ownerPeer)
      expect(nextView.ok).toBe(true)
      if (nextView.ok) {
        expect(JSON.stringify(nextView.value)).toContain('restored hello')
      }
    }
  })
})
