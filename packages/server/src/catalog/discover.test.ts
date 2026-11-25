import type { SessionAdapter } from '@rivus/agent-kit/sessions'
import type { Transcript } from '@rivus/agent-kit/transcript'
import { createNodePlatform } from '@rivus/agent-kit/node'
import { ok } from '@rivus/agent-kit/catalog'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import type { ShellPlatform } from '../sessions/load-session.ts'
import { homeRedaction } from '../sessions/redaction.ts'
import { SessionCatalog, type AgentProgress } from './session-catalog.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'discover-home-'))
  dirs.push(dir)
  return dir
}

const source = { file: 'fixture', offset: 0, length: 1, line: 1 }

/** An adapter with the given roots and `discover`; its sessions load a two-event transcript. */
function adapter(
  agent: string,
  displayName: string,
  roots: () => string[],
  discover: SessionAdapter['discover'],
): SessionAdapter {
  return {
    specificationVersion: 'sessions-v1',
    agent,
    displayName,
    // The adapter ignores its home; the rule only satisfies `sessionAdapterHome`.
    home: { defaultPath: [] },
    capabilities: ['requests'],
    roots,
    discover,
    async detect() {
      return false
    },
    async load(_platform, ref) {
      const transcript: Transcript = {
        agent,
        session: { id: ref.path },
        capabilities: ['requests'],
        agents: [{ id: 'main' }],
        events: [
          { id: 'u', seq: 0, ts: 1, kind: 'user', payload: { text: 'prompt' }, source },
          { id: 'r', seq: 1, ts: 2, kind: 'request', payload: { usage: { inputTokens: 1, outputTokens: 1 } }, source },
        ],
        skipped: [],
      }
      return ok(transcript)
    },
  }
}

const head = (agent: string, path: string, lastActiveAt: number) => ({
  ref: { agent, path },
  lastActiveAt,
  sizeBytes: 1,
})

/** The path as the catalog shows it: this platform's separators, with `~` for the home directory. */
const shown = (home: string, path: string): string => homeRedaction(home).text(path)

/** An I/O error as Node reports it, with its errno code. */
function ioError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

/** A `stat` failure as Node reports it for `path`, when the search permission of a folder on the way is gone. */
function ioErrorStat(path: string): Error {
  return ioError(`EACCES: permission denied, stat '${path}'`, 'EACCES')
}

/** `stat` as the real platform does it, except for the paths `failing` returns an error for. */
function platformFailingAt(home: string, failing: (path: string) => Promise<Error> | Error | undefined): ShellPlatform {
  const real = createNodePlatform({ home, env: {} })
  return {
    ...real,
    fs: {
      ...real.fs,
      async stat(path, options) {
        const error = await failing(path)
        if (error) {
          throw error
        }
        return real.fs.stat(path, options)
      },
    },
  }
}

describe('discover pass', () => {
  it('knows every root that could not be read before a failure elsewhere ends the pass', async () => {
    const home = await tempHome()
    const unreadable = join(home, '.claude/projects')
    const readable = join(home, 'sessions')
    const file = join(home, '1.jsonl')
    await mkdir(unreadable, { recursive: true })
    await mkdir(readable)
    await writeFile(file, 'x')
    // The unreadable root answers only once the other agent has already failed.
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    let otherFailed = false
    const platform = platformFailingAt(home, path => {
      if (path === unreadable) {
        return gate.then(() => ioError(`EACCES: permission denied, stat '${unreadable}'`, 'EACCES'))
      }
      if (path === file) {
        otherFailed = true
        return ioError("EIO: i/o error, stat '1.jsonl'", 'EIO')
      }
      return undefined
    })
    const adapters = {
      claude: adapter(
        'claude-code',
        'Claude Code',
        () => [unreadable],
        async function* () {},
      ),
      other: adapter(
        'other',
        'Other',
        () => [readable],
        async function* () {
          yield head('other', file, 1_000)
        },
      ),
    }
    const catalog = new SessionCatalog({ adapters, platform, noIndex: true })
    const started = catalog.start()
    const rootsWhenThePassFailed = started.then(
      () => [],
      () => catalog.unreadableRoots.map(root => root.path),
    )
    while (!otherFailed) {
      await new Promise(resolve => setImmediate(resolve))
    }
    await new Promise(resolve => setImmediate(resolve))
    release()
    expect(await rootsWhenThePassFailed).toEqual([shown(home, unreadable)])
    // The failure still ends the start.
    await expect(started).rejects.toThrow("EIO: i/o error, stat '1.jsonl'")
    catalog.close()
  })

  it('throws the failure that happened first, not the one of the first agent in the list', async () => {
    const home = await tempHome()
    // Listed first, fails second; listed second, fails first.
    const later = join(home, 'later')
    const sooner = join(home, 'sooner')
    const fileOf = (dir: string) => join(dir, 'session.jsonl')
    for (const dir of [later, sooner]) {
      await mkdir(dir)
      await writeFile(fileOf(dir), 'x')
    }
    let release!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const laterError = ioError("EACCES: permission denied, stat 'later/session.jsonl'", 'EACCES')
    const soonerError = ioError("EIO: i/o error, stat 'sooner/session.jsonl'", 'EIO')
    let soonerFailed = false
    const platform = platformFailingAt(home, path => {
      if (path === fileOf(later)) {
        return gate.then(() => laterError)
      }
      if (path === fileOf(sooner)) {
        soonerFailed = true
        return soonerError
      }
      return undefined
    })
    const adapters = {
      later: adapter(
        'later',
        'Later',
        () => [later],
        async function* () {
          yield head('later', fileOf(later), 1_000)
        },
      ),
      sooner: adapter(
        'sooner',
        'Sooner',
        () => [sooner],
        async function* () {
          yield head('sooner', fileOf(sooner), 1_000)
        },
      ),
    }
    const catalog = new SessionCatalog({ adapters, platform, noIndex: true })
    const started = catalog.start()
    while (!soonerFailed) {
      await new Promise(resolve => setImmediate(resolve))
    }
    await new Promise(resolve => setImmediate(resolve))
    release()
    const thrown: unknown = await started.catch(error => error)
    // The very error object, as `Promise.all` would have thrown it.
    expect(thrown).toBe(soonerError)
    catalog.close()
  })

  it('keeps the sessions read before `discover` failed, without calling the root unreadable', async () => {
    const home = await tempHome()
    const root = join(home, 'sessions')
    const first = join(root, '1.jsonl')
    const second = join(root, '2.jsonl')
    await mkdir(root)
    await writeFile(first, 'x')
    await writeFile(second, 'x')
    const failed = adapter(
      'fake',
      'Fake',
      () => [root],
      async function* () {
        yield head('fake', first, 1_000)
        // The second session's `stat` is refused inside the kit's reader.
        throw ioError("EIO: i/o error, stat '2.jsonl'", 'EIO')
      },
    )
    const catalog = new SessionCatalog({
      adapters: { fake: failed },
      platform: createNodePlatform({ home, env: {} }),
      noIndex: true,
    })
    let progress: readonly AgentProgress[] = []
    await catalog.start(agents => {
      progress = agents
    })
    const listed = await catalog.listSessions()
    expect(listed.rows.filter(row => !row.error).map(row => row.agent)).toEqual(['fake'])
    expect(listed.rows.filter(row => row.error)).toMatchObject([
      { agent: 'fake', error: { reason: "EIO: i/o error, stat '2.jsonl'", file: shown(home, root) } },
    ])
    expect(catalog.unreadableRoots).toEqual([])
    expect(progress.find(agent => agent.name === 'Fake')).toMatchObject({ read: 1, done: true })
    expect(progress.find(agent => agent.name === 'Fake')?.unreadable).toBeUndefined()
    catalog.close()
  })

  it('serves the rows of the index while its pass fails behind them', async () => {
    const home = await tempHome()
    const root = join(home, 'sessions')
    const file = join(home, '1.jsonl')
    await mkdir(root)
    await writeFile(file, 'x')
    const adapters = {
      fake: adapter(
        'fake',
        'Fake',
        () => [root],
        async function* () {
          yield head('fake', file, 1_000)
        },
      ),
    }
    // The first launch lists the session and leaves it in the index.
    const first = new SessionCatalog({
      adapters,
      platform: createNodePlatform({ home, env: {} }),
    })
    await first.listSessions()
    first.close()
    // The second loses the search permission while its pass reads the session it had already listed.
    const second = new SessionCatalog({
      adapters,
      platform: platformFailingAt(home, path => (path === file ? ioErrorStat(file) : undefined)),
    })
    await second.start()
    expect((await second.listSessions()).rows.filter(row => !row.error)).toHaveLength(1)
    expect(second.startedFromIndex).toBe(true)
    // The pass behind those rows fails: `start` kept its rows, and `discovered` is what rejects.
    await expect(second.discovered()).rejects.toThrow(`EACCES: permission denied, stat '${file}'`)
    second.close()
  })

  it('says a root once when it is reported more than once', async () => {
    const home = await tempHome()
    const root = join(home, '.claude/projects')
    await mkdir(root, { recursive: true })
    const platform = platformFailingAt(home, path =>
      path === root ? ioError(`EACCES: permission denied, stat '${root}'`, 'EACCES') : undefined,
    )
    // The same root listed twice: each `stat` fails.
    const adapters = {
      claude: adapter(
        'claude-code',
        'Claude Code',
        () => [root, root],
        async function* () {},
      ),
    }
    const catalog = new SessionCatalog({ adapters, platform, noIndex: true })
    let progress: readonly AgentProgress[] = []
    await catalog.start(agents => {
      progress = agents
    })
    const listed = await catalog.listSessions()
    expect(catalog.unreadableRoots).toHaveLength(1)
    expect(listed.rows.filter(row => row.error)).toHaveLength(1)
    expect(progress.find(agent => agent.name === 'Claude Code')?.unreadable).toBe(shown(home, root))
    catalog.close()
  })
})
