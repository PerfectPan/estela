import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoadHandle } from '@rivus/estela-rpc/trace-store'
import { createEstelaCore, traceIdOf, type EstelaCore } from '@rivus/estela-server/core'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createChannelHost } from './channel.ts'
import type { HostPeer, HostSessionPersistence, HostSessionSnapshot } from './rpc.ts'
import { createSessionRegistry, FIXED_FAILURE_MESSAGE } from './sessions.ts'

const FAKE_USER = 'fake-dsh-user-alice'
const processHome = homedir()
const dirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sessions-'))
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

function dshLogLines(id: string, prompt: string): string {
  return [
    JSON.stringify({ type: 'session', version: 4, id, createdAt: 1767225600000, cwd: '/tmp/work' }),
    JSON.stringify({
      type: 'user/message',
      seq: 1,
      time: 1767225601000,
      data: { role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' }, id: `u-${id}` },
    }),
  ].join('\n')
}

function samePath(a: string, b: string): boolean {
  return a.replaceAll('\\', '/') === b.replaceAll('\\', '/')
}

async function bumpMtime(file: string, stepMs = 5000): Promise<void> {
  const info = await stat(file)
  const next = new Date(Math.ceil(Math.max(Date.now(), info.mtimeMs) / 1000) * 1000 + stepMs)
  await utimes(file, next, next)
}

function buildCore(
  home: string,
  resolve: (traceId: string) => ReturnType<ReturnType<typeof createSessionRegistry>['resolve']>,
  fsOverride?: EstelaCore['platform']['fs'],
): EstelaCore {
  const base = createEstelaCore({ redacts: false }).platform
  return createEstelaCore({
    platform: { ...base, home, env: {}, ...(fsOverride ? { fs: fsOverride } : {}) },
    redacts: true,
    resolve,
  })
}

describe('createSessionRegistry', () => {
  it('issues opaque trace ids that change when file size or mtime changes and ignores location.kind', async () => {
    const home = await makeTempHome()
    const file = join(home, 'session.v4.jsonl')
    await writeFile(file, `${dshLogLines('s1', 'first')}\n`)

    const persistence: HostSessionPersistence = {
      stat: async () => ({ location: { kind: 'custom-backend', path: file } }),
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id))
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })

    const first = await registry.open('sess-1')
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    expect(first.traceId).not.toContain(file)
    expect(first.traceId).not.toContain('sess-1')
    expect(first.traceId).not.toContain(FAKE_USER)

    const again = await registry.open('sess-1')
    expect(again).toEqual(first)

    // Append to change size and mtime: a new id is issued.
    await writeFile(file, `${dshLogLines('s1', 'first and longer')}\n`)
    await bumpMtime(file, 5000)

    const second = await registry.open('sess-1')
    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }
    expect(second.traceId).not.toBe(first.traceId)
  })

  it('returns unknown-session, no-log, fixed stat failures, and redacted SessionFormatUnsupportedError messages', async () => {
    const home = await makeTempHome()
    const missingFile = join(home, 'missing.v4.jsonl')
    const badPath = join(home, '.dsh/sessions/s-v5/session.v5.jsonl')

    const formatErr = Object.assign(
      new Error(`session "s-v5" uses log format v5 with token sk-abcdefghijklmnop (raw log: ${badPath})`),
      { name: 'SessionFormatUnsupportedError', location: { kind: 'jsonl', path: badPath } },
    )
    const formatErrNoLocation = Object.assign(
      new Error(`session "s-v6" uses log format v6 at ${processHome}/secret (raw log: ${badPath})`),
      { name: 'SessionFormatUnsupportedError' },
    )

    const responses = new Map<string, () => Promise<HostSessionSnapshot | undefined>>([
      ['unknown', async () => undefined],
      ['pending', async () => ({})],
      ['missing', async () => ({ location: { kind: 'jsonl', path: missingFile } })],
      ['format-v5', async () => Promise.reject(formatErr)],
      ['format-v6', async () => Promise.reject(formatErrNoLocation)],
      ['crash', async () => Promise.reject(new Error(`boom at ${home}/private`))],
    ])
    const persistence: HostSessionPersistence = {
      stat: async id => {
        const fn = responses.get(id)
        return fn ? fn() : undefined
      },
    }

    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id))
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })

    const unknown = await registry.open('unknown')
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) {
      expect(unknown.result.error).toEqual({ code: 'estela/unknown-session', message: 'unknown session', details: {} })
    }

    const noLog = await registry.open('pending')
    expect(noLog.ok).toBe(false)
    if (!noLog.ok) {
      expect(noLog.result.error.code).toBe('estela/no-log')
      expect(noLog.result.error.details).toEqual({})
      namesNeitherHome(noLog.result.error.message, home)
    }

    const missing = await registry.open('missing')
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.result.error).toEqual({ code: 'estela/failed', message: FIXED_FAILURE_MESSAGE, details: {} })
    }

    const unsupported = await registry.open('format-v5')
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) {
      expect(unsupported.result.error.code).toBe('estela/failed')
      expect(unsupported.result.error.details).toEqual({})
      expect(unsupported.result.error.message).toMatch(/^dsh: .+:1: unknown format generation: .+$/)
      expect(unsupported.result.error.message).toContain('log format v5')
      expect(unsupported.result.error.message).not.toContain('sk-abcdefghijklmnop')
      namesNeitherHome(unsupported.result.error.message, home)
    }

    const unsupportedNoLoc = await registry.open('format-v6')
    expect(unsupportedNoLoc.ok).toBe(false)
    if (!unsupportedNoLoc.ok) {
      expect(unsupportedNoLoc.result.error.code).toBe('estela/failed')
      expect(unsupportedNoLoc.result.error.message).toMatch(/^dsh: .+:1: unknown format generation: .+$/)
      namesNeitherHome(unsupportedNoLoc.result.error.message, home)
    }

    const crashed = await registry.open('crash')
    expect(crashed.ok).toBe(false)
    if (!crashed.ok) {
      expect(crashed.result.error).toEqual({ code: 'estela/failed', message: FIXED_FAILURE_MESSAGE, details: {} })
      namesNeitherHome(crashed.result.error.message, home)
    }
  })

  it('retains only the 16 most recently issued trace ids and refuses older ones as unknown-trace', async () => {
    const home = await makeTempHome()
    const files: string[] = []
    for (let index = 0; index < 17; index += 1) {
      const file = join(home, `s-${index}.v4.jsonl`)
      await writeFile(file, `${dshLogLines(`s-${index}`, `prompt ${index}`)}\n`)
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

    const ids: string[] = []
    for (let index = 0; index < 17; index += 1) {
      const res = await registry.open(String(index))
      expect(res.ok).toBe(true)
      if (res.ok) {
        ids.push(res.traceId)
      }
    }

    expect(registry.resolve(ids[0]!)).toBeUndefined()
    const evictedCheck = await registry.checkReady(ids[0]!)
    expect(evictedCheck.ok).toBe(false)
    if (!evictedCheck.ok) {
      expect(evictedCheck.result.error.code).toBe('estela/unknown-trace')
    }

    for (const kept of ids.slice(1)) {
      expect(registry.resolve(kept)).toBeDefined()
    }
  })

  it('refuses an evicted session as stale when its file changes, drops its id, and reads no file content', async () => {
    const home = await makeTempHome()
    const files: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const dir = join(home, `evict-${index}`)
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'session.v4.jsonl')
      await writeFile(file, `${dshLogLines(`ev-${index}`, `msg ${index}`)}\n`)
      files.push(file)
    }

    const readCalls: string[] = []
    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const trackedFs: EstelaCore['platform']['fs'] = {
      ...baseFs,
      read: (path, options) => {
        readCalls.push(path)
        return baseFs.read(path, options)
      },
    }

    const persistence: HostSessionPersistence = {
      stat: async id => {
        const file = files[Number(id)]
        return file ? { location: { kind: 'jsonl', path: file } } : undefined
      },
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id), trackedFs)
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })

    const ids: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const opened = await registry.open(String(index))
      expect(opened.ok).toBe(true)
      if (!opened.ok) {
        return
      }
      ids.push(opened.traceId)
      await core.store.view(opened.traceId)
    }

    // Session 0 was evicted from TraceStore's 3-slot cache by sessions 1..3.
    expect(core.store.cachedKeys()).toEqual([ids[1], ids[2], ids[3]])
    expect(core.store.cachedKeys()).not.toContain(ids[0])
    expect(registry.resolve(ids[0]!)).toBeDefined()

    // While file 0 is unchanged, an evicted id is still ready (not falsely marked stale).
    const stillFresh = await registry.checkReady(ids[0]!)
    expect(stillFresh.ok).toBe(true)

    // Mutate session 0 on disk, then check readiness.
    readCalls.length = 0
    await writeFile(files[0]!, `${dshLogLines('ev-0', 'mutated content after eviction')}\n`)
    await bumpMtime(files[0]!, 5000)

    const stale = await registry.checkReady(ids[0]!)
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.result.error.code).toBe('estela/stale')
      expect(stale.result.error.details).toEqual({})
      namesNeitherHome(stale.result.error.message, home)
    }

    // The file was not read and the stale id was dropped.
    expect(readCalls).toEqual([])
    expect(registry.resolve(ids[0]!)).toBeUndefined()
    const afterDrop = await registry.checkReady(ids[0]!)
    expect(afterDrop.ok).toBe(false)
    if (!afterDrop.ok) {
      expect(afterDrop.result.error.code).toBe('estela/unknown-trace')
    }
  })

  it('does not repopulate issued when dispose occurs while fs.stat in open is still pending', async () => {
    const home = await makeTempHome()
    const dir = join(home, 'dispose-race')
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'session.v4.jsonl')
    await writeFile(file, `${dshLogLines('race', 'pending stat')}\n`)

    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const realInfo = await baseFs.stat(file, { followSymlinks: true })
    expect(realInfo).toBeDefined()
    const expectedTraceId = traceIdOf({ agent: 'dsh', path: file, sessionId: `${realInfo!.size}:${realInfo!.mtimeMs}` })

    let statEntered!: () => void
    const entered = new Promise<void>(resolve => {
      statEntered = resolve
    })
    let releaseStat!: () => void
    const statGate = new Promise<void>(resolve => {
      releaseStat = resolve
    })

    const gatedFs: EstelaCore['platform']['fs'] = {
      ...baseFs,
      async stat(path, options) {
        if (samePath(path, file)) {
          statEntered()
          await statGate
        }
        return baseFs.stat(path, options)
      },
    }

    const persistence: HostSessionPersistence = {
      stat: async () => ({ location: { kind: 'jsonl', path: file } }),
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id), gatedFs)
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })
    const channel = createChannelHost({ core, sessions: registry })
    const ownerPeer: HostPeer = { principal: { kind: 'owner' } }

    const openCall = channel.handler('session/open', { sessionId: 'race' }, new AbortController().signal, ownerPeer)
    await entered

    channel.dispose()
    releaseStat()

    const result = await openCall
    expect(result).toEqual({
      ok: false,
      error: { code: 'estela/closed', message: 'the plugin is closed', details: {} },
    })
    // Wait a tick for the post-stat continuation in `sessions.open` to finish.
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    expect(registry.resolve(expectedTraceId)).toBeUndefined()
  })

  it('keeps an evicted in-flight trace id resolvable until its last channel holder unpins', async () => {
    const home = await makeTempHome()
    const files: string[] = []
    for (let index = 0; index < 17; index += 1) {
      const dir = join(home, `pin-${index}`)
      await mkdir(dir, { recursive: true })
      const file = join(dir, 'session.v4.jsonl')
      await writeFile(file, `${dshLogLines(`pin-${index}`, `msg ${index}`)}\n`)
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

    const resolvers: Array<() => void> = []
    vi.spyOn(core.store, 'open').mockImplementation(async () => {
      const done = new Promise<void>(resolve => {
        resolvers.push(resolve)
      })
      const handle: LoadHandle = {
        cached: false,
        progress: () => ({ bytesRead: 0, totalBytes: 10 }),
        onProgress: () => () => {},
        done,
        release: () => {},
      }
      return handle
    })

    const channel = createChannelHost({ core, sessions: registry })
    const ownerPeer: HostPeer = { principal: { kind: 'owner' } }
    const signal = new AbortController().signal

    const first = await registry.open('0')
    expect(first.ok).toBe(true)
    if (!first.ok) {
      return
    }
    const id0 = first.traceId

    // Two concurrent channel views hold pins on id0.
    const view1 = channel.handler('trace/view', { traceId: id0 }, signal, ownerPeer)
    const view2 = channel.handler('trace/view', { traceId: id0 }, signal, ownerPeer)
    await vi.waitFor(() => {
      expect(resolvers).toHaveLength(2)
    })

    // Issue 16 more ids, pushing id0 out of the 16-id issued map.
    for (let index = 1; index < 17; index += 1) {
      const opened = await registry.open(String(index))
      expect(opened.ok).toBe(true)
    }
    // New calls refuse evicted id0, but the in-flight pin still resolves it for both holders.
    const rejected = await registry.checkReady(id0)
    expect(rejected.ok).toBe(false)
    expect(registry.resolve(id0)).toBeDefined()

    // First holder finishes: second holder's pin still keeps id0 resolvable.
    resolvers[0]!()
    expect((await view1).ok).toBe(true)
    expect(registry.resolve(id0)).toBeDefined()

    // Last holder finishes: unpin drops the last reference and id0 is no longer resolvable.
    resolvers[1]!()
    expect((await view2).ok).toBe(true)
    expect(registry.resolve(id0)).toBeUndefined()
  })

  it('returns estela/failed and keeps the id when cold checkReady stat throws', async () => {
    const home = await makeTempHome()
    const file = join(home, 'stat-fail.v4.jsonl')
    await writeFile(file, `${dshLogLines('sf', 'hi')}\n`)

    let failStat = false
    const baseFs = createEstelaCore({ redacts: false }).platform.fs
    const flakyFs: EstelaCore['platform']['fs'] = {
      ...baseFs,
      async stat(path, options) {
        if (failStat && samePath(path, file)) {
          throw new Error('EIO: temporary stat failure')
        }
        return baseFs.stat(path, options)
      },
    }
    const persistence: HostSessionPersistence = {
      stat: async () => ({ location: { kind: 'jsonl', path: file } }),
    }
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = buildCore(home, id => registry.resolve(id), flakyFs)
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })

    const opened = await registry.open('sf')
    expect(opened.ok).toBe(true)
    if (!opened.ok) {
      return
    }
    failStat = true
    const failed = await registry.checkReady(opened.traceId)
    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.result.error).toEqual({ code: 'estela/failed', message: FIXED_FAILURE_MESSAGE, details: {} })
    }
    expect(registry.resolve(opened.traceId)).toBeDefined()
  })
})
