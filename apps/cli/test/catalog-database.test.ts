import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ok } from '@rivus/agent-kit/catalog'
import { createNodePlatform } from '@rivus/agent-kit/node'
import type { SessionAdapter } from '@rivus/agent-kit/sessions'
import { openSessionIndex } from '@rivus/agent-trace-runtime-node'
import { expect, it } from 'vite-plus/test'
import { SessionCatalog } from '../src/catalog.ts'

it('keeps database session ids stable and invalidates cached summaries when only WAL changes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'catalog-db-'))
  const root = join(home, 'sessions')
  await mkdir(root)
  const path = join(root, 'opencode.db')
  await writeFile(path, 'unchanged database')
  let counts = [1, 2]
  const source = { file: path, offset: 0, length: 0, line: 1 }
  const adapter: SessionAdapter = {
    specificationVersion: 'sessions-v1',
    agent: 'opencode',
    displayName: 'OpenCode',
    home: { defaultPath: [] },
    capabilities: ['requests'],
    roots: () => [root],
    async *discover() {
      for (let i = 0; i < counts.length; i++) {
        yield { ref: { agent: 'opencode', path, sessionId: String(i) }, lastActiveAt: 1, sizeBytes: 0 }
      }
    },
    async detect() {
      return false
    },
    async load(_platform, ref) {
      return ok({
        agent: 'opencode',
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
      adapters: { opencode: adapter },
      index: openSessionIndex({ file: join(home, 'index.sqlite'), summaryVersion: 1 }),
    })
  let catalog = open()
  try {
    await catalog.whenIdle()
    const before = (await catalog.listSessions()).rows
    expect(before.map(row => row.requests).toSorted((a, b) => a! - b!)).toEqual([1, 2])
    catalog.close()
    counts = [3]
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
