import type { SessionCatalog } from '@rivus/estela-server'
import { homeDir } from '@rivus/estela-runtime-node'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { CliError, failureReport } from '../failure.ts'
import { runDev } from './dev.ts'

/**
 * What `runDev` is given instead of the dev server. `createEstelaServer` cannot be handed a platform, and the real
 * one reads this user's own agent folders, so the catalog here is the part of one `runDev` reaches before `--pick`
 * fails: as on a second launch whose rows the index served and whose `discover` pass then failed.
 */
let server:
  | {
      catalog: Pick<
        SessionCatalog,
        'indexUnavailable' | 'start' | 'listSessions' | 'startedFromIndex' | 'unreadableRoots' | 'discovered'
      >
      close: () => void
    }
  | undefined

vi.mock('../../server.ts', () => ({
  createEstelaServer: () => {
    if (!server) {
      throw new Error('no server was prepared for runDev')
    }
    return server
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  server = undefined
})

const input = {
  launch: undefined,
  pick: true,
  port: undefined,
  host: 'localhost',
  open: false,
  auth: true,
  mcp: undefined,
  index: true,
  redacts: true,
} as const

describe('runDev with --pick', () => {
  it('ends with the redacted index failure when the discover pass fails behind the rows the index served', async () => {
    // As when a folder loses its search permission while the pass reads it: the stat made for a session's cache key fails.
    const cause = Object.assign(new Error(`EACCES: permission denied, stat '${homeDir()}/sessions/session.jsonl'`), {
      code: 'EACCES',
    })
    let closed = false
    server = {
      catalog: {
        indexUnavailable: undefined,
        startedFromIndex: true,
        unreadableRoots: [],
        start: async () => {},
        listSessions: async () => ({
          agents: [{ id: 'fake', displayName: 'Fake', count: 1 }],
          rows: [],
          complete: true,
          pending: 0,
          revision: 1,
          pricesVersion: 'test',
        }),
        discovered: async () => {
          throw cause
        },
      },
      close: () => {
        closed = true
      },
    }
    const output: string[] = []
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation(chunk => {
        output.push(String(chunk))
        return true
      })
    }

    const thrown: unknown = await runDev({ ...input }, '0.0.0').catch(error => error)
    if (!(thrown instanceof CliError)) {
      throw new TypeError(`a CliError was expected, got ${String(thrown)}`)
    }
    expect(thrown).not.toBe(cause)
    expect(failureReport(thrown.failure)).toEqual({
      message: {
        cause: "Could not index sessions: EACCES: permission denied, stat '~/sessions/session.jsonl'",
        fix: 'Check the agent session directories, or pass --no-index.',
      },
      exitCode: 1,
    })
    // The failure left through the command's one exit: the server is closed and the output has no stack.
    expect(closed).toBe(true)
    expect(output.join('')).toContain('1 sessions from the index')
    expect(output.join('')).not.toContain(homeDir())
    expect(output.join('')).not.toContain('\n    at ')
  })
})
