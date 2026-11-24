import { createNodePlatform } from '@rivus/agent-kit/node'
import { CURRENT_TRACE_ID } from '@rivus/estela-rpc/trace-store'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { loadSession } from '../sessions/load-session.ts'
import { traceIdOf as sessionTraceIdOf } from '../sessions/session-target.ts'
import { createEstelaCore, traceIdOf } from './estela-core.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const plainFixture = join(repo, 'fixtures/sessions/claude-code/conformance/plain/session.jsonl')
const compactionFixture = join(repo, 'fixtures/sessions/claude-code/conformance/compaction/session.jsonl')

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempHome(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
  dirs.push(dir)
  return dir
}

describe('createEstelaCore', () => {
  it('isolates two cores reading different fixtures in one process', async () => {
    const homeA = await tempHome('core-a')
    const homeB = await tempHome('core-b')
    const idA = traceIdOf({ agent: 'claude-code', path: plainFixture })
    const idB = traceIdOf({ agent: 'claude-code', path: compactionFixture })
    expect(idA).toBe(sessionTraceIdOf({ agent: 'claude-code', path: plainFixture }))
    expect(idA).not.toBe(idB)

    const coreA = createEstelaCore({
      platform: createNodePlatform({ home: homeA, env: {} }),
      redacts: true,
      resolve: traceId => (traceId === idA ? { key: idA, target: { path: plainFixture } } : undefined),
    })
    const coreB = createEstelaCore({
      platform: createNodePlatform({ home: homeB, env: {} }),
      redacts: true,
      resolve: traceId => (traceId === idB ? { key: idB, target: { path: compactionFixture } } : undefined),
    })

    const [viewA, viewB] = await Promise.all([coreA.store.view(idA), coreB.store.view(idB)])
    expect(viewA.traceId).toBe(idA)
    expect(viewB.traceId).toBe(idB)
    expect(viewA.trace.session.id).not.toBe(viewB.trace.session.id)
    expect(viewA.trace.events.length).toBeGreaterThan(0)
    expect(viewB.trace.events.length).toBeGreaterThan(0)

    // Neither core resolves or serves the other's trace id.
    await expect(coreA.store.view(idB)).rejects.toThrow(`unknown trace id: ${idB}`)
    await expect(coreB.store.view(idA)).rejects.toThrow(`unknown trace id: ${idA}`)

    // Seeding `current` on core A does not affect core B.
    const traceA = await loadSession({ path: plainFixture }, { platform: coreA.platform })
    await coreA.seed({ key: idA, target: { path: plainFixture } }, traceA)
    const currentA = await coreA.store.view(CURRENT_TRACE_ID)
    expect(currentA.trace.session.id).toBe(traceA.session.id)
    await expect(coreB.store.view(CURRENT_TRACE_ID)).rejects.toThrow(`unknown trace id: ${CURRENT_TRACE_ID}`)
  })

  it('follows the redacts switch for both core.redact and stored views', async () => {
    const home = await tempHome('core-redact')
    const file = join(home, 'session.jsonl')
    const processHome = homedir()
    const record = {
      sessionId: 's-core-redact',
      version: '2.0.0',
      cwd: join(home, 'work'),
      type: 'user',
      uuid: 'u-1',
      timestamp: '2026-02-01T00:00:00.000Z',
      message: {
        role: 'user',
        content: `Read ${join(home, 'secret.txt')} and ${join(processHome, '.ssh/id_rsa')} with sk-abcdefghijklmnop`,
      },
    }
    await writeFile(file, `${JSON.stringify(record)}\n`)

    const traceId = traceIdOf({ agent: 'claude-code', path: file })
    const resolve = (id: string) => (id === traceId ? { key: traceId, target: { path: file } } : undefined)

    const redacted = createEstelaCore({
      platform: createNodePlatform({ home, env: {} }),
      redacts: true,
      resolve,
    })
    const raw = createEstelaCore({
      platform: createNodePlatform({ home, env: {} }),
      redacts: false,
      resolve,
    })

    const sample = `at ${join(home, 'a')} and ${join(processHome, 'b')} token sk-abcdefghijklmnop`
    expect(redacted.redact(sample)).not.toContain(home)
    expect(redacted.redact(sample)).not.toContain(processHome)
    expect(redacted.redact(sample)).not.toContain('sk-abcdefghijklmnop')
    expect(raw.redact(sample)).toBe(sample)

    const redactedView = JSON.stringify(await redacted.store.view(traceId))
    expect(redactedView).not.toContain(home)
    expect(redactedView).not.toContain(processHome)
    expect(redactedView).not.toContain('sk-abcdefghijklmnop')

    const rawView = JSON.stringify(await raw.store.view(traceId))
    expect(rawView).toContain('sk-abcdefghijklmnop')
  })
})
