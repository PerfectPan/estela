import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEstelaCore, type EstelaCore } from '@rivus/estela-server/core'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import type { HostSessionPersistence, HostSessionSnapshot } from './rpc.ts'
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
    const bumped = new Date(Date.now() + 5000)
    await utimes(file, bumped, bumped)

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
    if (!unknown.ok && !unknown.result.ok) {
      expect(unknown.result.error).toEqual({ code: 'estela/unknown-session', message: 'unknown session', details: {} })
    }

    const noLog = await registry.open('pending')
    expect(noLog.ok).toBe(false)
    if (!noLog.ok && !noLog.result.ok) {
      expect(noLog.result.error.code).toBe('estela/no-log')
      expect(noLog.result.error.details).toEqual({})
      namesNeitherHome(noLog.result.error.message, home)
    }

    const missing = await registry.open('missing')
    expect(missing.ok).toBe(false)
    if (!missing.ok && !missing.result.ok) {
      expect(missing.result.error).toEqual({ code: 'estela/failed', message: FIXED_FAILURE_MESSAGE, details: {} })
    }

    const unsupported = await registry.open('format-v5')
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok && !unsupported.result.ok) {
      expect(unsupported.result.error.code).toBe('estela/failed')
      expect(unsupported.result.error.details).toEqual({})
      expect(unsupported.result.error.message).toMatch(/^dsh: .+:1: unknown format generation: .+$/)
      expect(unsupported.result.error.message).toContain('log format v5')
      expect(unsupported.result.error.message).not.toContain('sk-abcdefghijklmnop')
      namesNeitherHome(unsupported.result.error.message, home)
    }

    const unsupportedNoLoc = await registry.open('format-v6')
    expect(unsupportedNoLoc.ok).toBe(false)
    if (!unsupportedNoLoc.ok && !unsupportedNoLoc.result.ok) {
      expect(unsupportedNoLoc.result.error.code).toBe('estela/failed')
      expect(unsupportedNoLoc.result.error.message).toMatch(/^dsh: .+:1: unknown format generation: .+$/)
      namesNeitherHome(unsupportedNoLoc.result.error.message, home)
    }

    const crashed = await registry.open('crash')
    expect(crashed.ok).toBe(false)
    if (!crashed.ok && !crashed.result.ok) {
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
    if (!evictedCheck.ok && !evictedCheck.result.ok) {
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
    const bumped = new Date(Date.now() + 5000)
    await utimes(files[0]!, bumped, bumped)

    const stale = await registry.checkReady(ids[0]!)
    expect(stale.ok).toBe(false)
    if (!stale.ok && !stale.result.ok) {
      expect(stale.result.error.code).toBe('estela/stale')
      expect(stale.result.error.details).toEqual({})
      namesNeitherHome(stale.result.error.message, home)
    }

    // The file was not read and the stale id was dropped.
    expect(readCalls).toEqual([])
    expect(registry.resolve(ids[0]!)).toBeUndefined()
    const afterDrop = await registry.checkReady(ids[0]!)
    expect(afterDrop.ok).toBe(false)
    if (!afterDrop.ok && !afterDrop.result.ok) {
      expect(afterDrop.result.error.code).toBe('estela/unknown-trace')
    }
  })
})
