import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ok } from '@rivus/agent-kit/catalog'
import { createNodePlatform } from '@rivus/agent-kit/node'
import type { SessionAdapter } from '@rivus/agent-kit/sessions'
import { openSessionIndex } from '@rivus/estela-runtime-node'
import { expect, it } from 'vite-plus/test'
import { SessionCatalog } from '../src/catalog/session-catalog.ts'

// The agents whose sessions are rows of one shared database (`DATABASE_AGENTS`); each row is keyed by its session's
// own last write.
for (const agent of ['opencode', 'zcode', 'dim'] as const) {
  it(`keeps ${agent} session ids stable and invalidates a cached summary when the session is written`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'catalog-db-'))
    const root = join(home, 'sessions')
    await mkdir(root)
    const path = join(root, 'sessions.db')
    await writeFile(path, 'unchanged database')
    let counts = [1, 2]
    // Each session's own last write. The WAL write below changes the shared database stamp, not this.
    const activity = [1, 1]
    const source = { file: path, offset: 0, length: 0, line: 1 }
    const adapter: SessionAdapter = {
      specificationVersion: 'sessions-v1',
      agent,
      displayName: agent,
      home: { defaultPath: [] },
      capabilities: ['requests'],
      roots: () => [root],
      async *discover() {
        for (let i = 0; i < counts.length; i++) {
          yield { ref: { agent, path, sessionId: String(i) }, lastActiveAt: activity[i]!, sizeBytes: 0 }
        }
      },
      async detect() {
        return false
      },
      async load(_platform, ref) {
        return ok({
          agent,
          session: { id: ref.sessionId! },
          capabilities: ['requests'],
          agents: [{ id: 'main' }],
          skipped: [],
          events: Array.from({ length: counts[Number(ref.sessionId)]! }, (_, i) => ({
            id: String(i),
            seq: i,
            ts: i,
            kind: 'request' as const,
            payload: {},
            source,
          })),
        })
      },
    }
    const open = () =>
      new SessionCatalog({
        platform: createNodePlatform({ home, env: {} }),
        adapters: { [agent]: adapter },
        index: openSessionIndex({ file: join(home, 'index.sqlite'), summaryVersion: 1 }),
      })
    let catalog = open()
    try {
      await catalog.whenIdle()
      const before = (await catalog.listSessions()).rows
      expect(before.map(row => row.requests).toSorted((a, b) => a! - b!)).toEqual([1, 2])
      catalog.close()
      counts = [3]
      activity[0] = 500
      await writeFile(`${path}-wal`, 'new committed rows')
      catalog = open()
      await catalog.whenIdle()
      const after = (await catalog.listSessions()).rows
      expect(after).toHaveLength(1)
      expect(after[0]?.traceId).toBe(before.find(row => row.requests === 1)?.traceId)
      expect(after[0]?.requests).toBe(3)
    } finally {
      catalog.close()
      await rm(home, { recursive: true, force: true })
    }
  })

  it(`recomputes only the session whose own last write changed after a ${agent} write`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'catalog-db-'))
    const root = join(home, 'sessions')
    await mkdir(root)
    const path = join(root, 'sessions.db')
    await writeFile(path, 'unchanged database')
    // Two sessions in one database. The database file never changes; only the second session is written.
    const counts = [1, 2]
    const stamps = [100, 200]
    const loads: string[] = []
    const source = { file: path, offset: 0, length: 0, line: 1 }
    const adapter: SessionAdapter = {
      specificationVersion: 'sessions-v1',
      agent,
      displayName: agent,
      home: { defaultPath: [] },
      capabilities: ['requests'],
      roots: () => [root],
      async *discover() {
        for (let i = 0; i < counts.length; i++) {
          yield {
            ref: { agent, path, sessionId: String(i) },
            lastActiveAt: stamps[i]!,
            sizeBytes: 0,
          }
        }
      },
      async detect() {
        return false
      },
      async load(_platform, ref) {
        const count = counts[Number(ref.sessionId)]!
        loads.push(ref.sessionId!)
        return ok({
          agent,
          session: { id: ref.sessionId! },
          capabilities: ['requests'],
          agents: [{ id: 'main' }],
          skipped: [],
          events: Array.from({ length: count }, (_, i) => ({
            id: String(i),
            seq: i,
            ts: i,
            kind: 'request' as const,
            payload: {},
            source,
          })),
        })
      },
    }
    const open = () =>
      new SessionCatalog({
        platform: createNodePlatform({ home, env: {} }),
        adapters: { [agent]: adapter },
        index: openSessionIndex({ file: join(home, 'index.sqlite'), summaryVersion: 1 }),
      })
    let catalog = open()
    try {
      await catalog.whenIdle()
      loads.length = 0
      catalog.close()
      counts[1] = 3
      stamps[1] = 300
      // Another write to the shared database, as a commit that stays in the WAL: the size stamp changes.
      await writeFile(`${path}-wal`, 'new committed rows')
      catalog = open()
      await catalog.whenIdle()
      // Keyed by its own last write, the unchanged session comes from its cache entry, although the WAL write moved
      // the database's stamp.
      expect(loads.toSorted()).toEqual(['1'])
      const after = (await catalog.listSessions()).rows
      expect(after.map(row => row.requests).toSorted((a, b) => a! - b!)).toEqual([1, 3])
    } finally {
      catalog.close()
      await rm(home, { recursive: true, force: true })
    }
  })

  it(`keeps every ${agent} row unchanged across a cached start when nothing was written`, async () => {
    const home = await mkdtemp(join(tmpdir(), 'catalog-db-'))
    const root = join(home, 'sessions')
    await mkdir(root)
    const path = join(root, 'sessions.db')
    await writeFile(path, 'unchanged database')
    await writeFile(`${path}-wal`, 'committed rows')
    const source = { file: path, offset: 0, length: 0, line: 1 }
    const adapter: SessionAdapter = {
      specificationVersion: 'sessions-v1',
      agent,
      displayName: agent,
      home: { defaultPath: [] },
      capabilities: ['requests'],
      roots: () => [root],
      async *discover() {
        for (const [index, stamp] of [100, 200].entries()) {
          yield { ref: { agent, path, sessionId: String(index) }, lastActiveAt: stamp, sizeBytes: 0 }
        }
      },
      async detect() {
        return false
      },
      async load(_platform, ref) {
        return ok({
          agent,
          session: { id: ref.sessionId! },
          capabilities: ['requests'],
          agents: [{ id: 'main' }],
          skipped: [],
          events: [{ id: '0', seq: 0, ts: 0, kind: 'request' as const, payload: {}, source }],
        })
      },
    }
    const file = join(home, 'index.sqlite')
    const open = () =>
      new SessionCatalog({
        platform: createNodePlatform({ home, env: {} }),
        adapters: { [agent]: adapter },
        index: openSessionIndex({ file, summaryVersion: 1 }),
      })
    const first = open()
    await first.whenIdle()
    first.close()
    const second = open()
    try {
      // The rows the index holds, then this start's discovery: a row it finds unchanged keeps its revision.
      const cached = await second.listSessions()
      await second.discovered()
      expect((await second.listSessions({ since: cached.revision })).rows).toEqual([])
    } finally {
      second.close()
      await rm(home, { recursive: true, force: true })
    }
  })
}
