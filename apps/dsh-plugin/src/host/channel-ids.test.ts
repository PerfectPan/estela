import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEstelaCore } from '@rivus/estela-server/core'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { createChannelHost } from './channel.ts'
import type { HostPeer, HostSessionPersistence, RpcHandlerResult } from './rpc.ts'
import { createSessionRegistry } from './sessions.ts'

/**
 * The dsh reader names a main-lane event after its log file and line, and a dsh log is always `session.v4.jsonl`, so
 * a subagent lane's events are named `<child session id>:session.v4.jsonl:<line>`. A child id with a space in it is
 * a legal one that redaction cannot show as written: the plugin's channel gives it an alias and takes the alias back.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const conformance = join(repo, 'fixtures/sessions/dsh/conformance')
const processHome = homedir()
const ownerPeer: HostPeer = { principal: { kind: 'owner' } }
const dirs: string[] = []

const openValue = z.object({ traceId: z.string() })
const eventValue = z.object({ id: z.string(), original: z.unknown() })

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function makeTempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-host-ids-'))
  dirs.push(home)
  return home
}

/**
 * Neither home, in any spelling an output could carry: as the system writes it, with Windows separators
 * (`path.win32`), with forward slashes, and each JSON-escaped. Compared without case, as the kit hides a home.
 */
function namesNeitherHome(text: string, home: string): void {
  const spellings = (path: string): string[] => {
    const forms = [path, win32.normalize(path), path.replaceAll('\\', '/')]
    return forms.flatMap(one => [one, JSON.stringify(one).slice(1, -1)])
  }
  const shown = text.toLowerCase()
  for (const needle of [home, processHome].flatMap(spellings)) {
    expect(shown).not.toContain(needle.toLowerCase())
  }
}

/** The parent session of the conformance fixtures beside its spawn child, under a name with a space in it. */
async function parentWithNamedChild(home: string): Promise<string> {
  const parent = join(home, 'project', 'dsh-parent', 'session.v4.jsonl')
  const child = join(home, 'project', 'spawn child', 'session.v4.jsonl')
  const renamed = async (from: string, before: string, after: string): Promise<string> =>
    (await readFile(join(conformance, from), 'utf8')).replace(before, after)
  await mkdir(dirname(parent), { recursive: true })
  await mkdir(dirname(child), { recursive: true })
  // The first prompt names the process home, so the output has that home to hide too.
  const prompt = JSON.stringify(`delegate work from ${join(processHome, 'notes.md')}`).slice(1, -1)
  const parentText = await renamed('parent/session.v4.jsonl', '"childId":"spawn-child"', '"childId":"spawn child"')
  await writeFile(parent, parentText.replace('"text":"delegate work"', `"text":"${prompt}"`))
  await writeFile(child, await renamed('spawn-child/session.v4.jsonl', '"id":"spawn-child"', '"id":"spawn child"'))
  return parent
}

describe('dsh host channel and event ids', () => {
  it('shows a subagent lane and its events under aliases, and reads an event back by one', async () => {
    const home = await makeTempHome()
    const parent = await parentWithNamedChild(home)
    const persistence: HostSessionPersistence = { stat: async () => ({ location: { kind: 'jsonl', path: parent } }) }
    const base = createEstelaCore({ redacts: false }).platform
    let registry!: ReturnType<typeof createSessionRegistry>
    const core = createEstelaCore({
      platform: { ...base, home, env: {} },
      redacts: true,
      resolve: id => registry.resolve(id),
    })
    registry = createSessionRegistry({ persistence, fs: core.platform.fs, store: core.store, redact: core.redact })
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
    // On the whole answer as it leaves the channel: a field a schema would drop could carry a home too.
    const view = JSON.stringify(viewRes.value)
    expect(view).toContain('"id":"@l1"')
    expect(view).toContain('"id":"@e3"')
    namesNeitherHome(view, home)
    const ids: string[] = JSON.parse(z.string().parse(view))
      .trace.events.filter((event: { agentId?: string }) => event.agentId === '@l1')
      .map((event: { id: string }) => event.id)
    expect(ids).toContain('@e3')
    expect(ids.every(id => /^@e\d+$/.test(id))).toBe(true)

    for (const id of ids) {
      const eventRes = await call('trace/event', { traceId, id })
      expect(eventRes.ok).toBe(true)
      if (!eventRes.ok) {
        return
      }
      const event = z.parse(eventValue, eventRes.value)
      expect(event.id).toBe(id)
      expect(event.original).toBeDefined()
      namesNeitherHome(JSON.stringify(eventRes.value), home)
    }
    // The main lane's ids are the log's own name and line, and are shown as they are.
    expect(view).toContain('"id":"session.v4.jsonl:2"')
    // An alias no event has is refused, and the refusal says which, without a home.
    const beyond = `@e${JSON.parse(z.string().parse(view)).trace.events.length}`
    const missing = await call('trace/event', { traceId, id: beyond })
    expect(missing).toEqual({
      ok: false,
      error: { code: 'estela/failed', message: `no event ${beyond} in ${traceId}`, details: {} },
    })
    channel.dispose()
  })
})
