import type { Page } from '@playwright/test'
import type { Server } from '../cli-process.ts'
import type { E2eContext } from './global-setup.ts'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { test as base, expect } from '@playwright/test'
import { openedUrls, smokeEnv, start, waitFor } from '../cli-process.ts'
import { CONTEXT_ENV } from './global-setup.ts'

export { expect }

const exec = promisify(execFile)

export interface Launched {
  /** `http://localhost:<port>/__agent-trace/`. */
  base: string
  /** The launch session's trace id, when a path was given. */
  traceId?: string
  /** URLs the fake opener received (auth on: they carry the one-time code). */
  opened: () => string[]
  /** The server's working directory ("Export report" writes here). */
  cwd: string
}

export interface LaunchOptions {
  /** CLI arguments before `--port 0`, e.g. a session path or `--no-auth`. */
  args?: string[]
  home?: string
  env?: Record<string, string>
  /** Wait for the fake opener to receive a URL as well as for the Ready line. */
  waitOpened?: boolean
}

interface Fixtures {
  /** Starts the installed CLI; every server is stopped after the test. */
  launch: (options?: LaunchOptions) => Promise<Launched>
  /** Console errors and page errors of every page in the test. Checked after the test. */
  consoleErrors: string[]
}

const READY = /Ready: (http:\/\/localhost:\d+\/__agent-trace\/)(?:#\/s\/([0-9a-f]+))?/

function readContext(): E2eContext {
  const raw = process.env[CONTEXT_ENV]
  if (!raw) {
    throw new Error(`${CONTEXT_ENV} is not set; run through playwright.config.ts`)
  }
  return JSON.parse(raw) as E2eContext
}

export const ctx = readContext()

let runs = 0

export const test = base.extend<Fixtures>({
  consoleErrors: [
    async ({ context }, use) => {
      const errors: string[] = []
      context.on('console', message => {
        if (message.type() === 'error') {
          errors.push(`console: ${message.text()}`)
        }
      })
      context.on('weberror', error => errors.push(`page error: ${error.error().message}`))
      await use(errors)
      expect(errors, 'console errors').toEqual([])
    },
    { auto: true },
  ],

  // eslint-disable-next-line no-empty-pattern -- Playwright reads the fixture's dependencies from this pattern.
  launch: async ({}, use) => {
    const servers: Server[] = []
    await use(async (options = {}) => {
      runs += 1
      const cwd = await mkdtemp(join(ctx.root, `run-${runs}-`))
      const cache = join(cwd, 'cache')
      await mkdir(cache, { recursive: true })
      const openLog = join(cwd, 'opened.log')
      const home = options.home ?? ctx.homes.main.home
      const server = start(process.execPath, [ctx.bin, ...(options.args ?? []), '--port', '0'], {
        cwd,
        env: smokeEnv({ home, cache, fakeBin: ctx.fakeBin }, openLog, options.env),
      })
      servers.push(server)
      const ready = () => READY.exec(server.output().stdout)
      await waitFor(
        'the Ready line',
        () => ready() !== null && (!options.waitOpened || openedUrls(openLog).length > 0),
        30_000,
      ).catch((error: Error) => {
        throw new Error(`${error.message}\nstdout:\n${server.output().stdout}\nstderr:\n${server.output().stderr}`)
      })
      const match = ready()!
      return { base: match[1]!, traceId: match[2], opened: () => openedUrls(openLog), cwd }
    })
    for (const server of servers) {
      await server.stop()
    }
  },
})

/** The dev server with auth off and no browser opener, showing `path`'s workspace. */
export async function openWorkspace(
  page: Page,
  launch: Fixtures['launch'],
  path: string,
  options: Omit<LaunchOptions, 'args'> = {},
): Promise<Launched> {
  const server = await launch({ ...options, args: [path, '--no-auth', '--no-open'] })
  await page.goto(`${server.base}#/s/${server.traceId}`)
  await expect(page.getByTestId('ledger')).toBeVisible()
  return server
}

/** The open inspector tab panel. */
export function activePanel(page: Page) {
  return page.locator('[role=tabpanel]:not([hidden])')
}

/** `scripts/generate-trace.mjs`: a synthetic canonical trace of about `events` events in `dir`; returns its path. */
export async function generateTrace(dir: string, events: number): Promise<string> {
  const { stdout } = await exec(process.execPath, [
    join(ctx.repo, 'scripts/generate-trace.mjs'),
    '--events',
    String(events),
    '--out',
    dir,
  ])
  // The script prints the path, then a summary line.
  return stdout.split('\n')[0]!
}

/** `apps/cli/src/testsupport/large-session.ts` run by path: a synthetic Codex rollout of at least `bytes` in `dir`. */
export async function generateCodex(
  dir: string,
  bytes: number,
): Promise<{ path: string; bytes: number; turns: number; longOutputs: number }> {
  const { stdout } = await exec(
    process.execPath,
    [join(ctx.repo, 'apps/cli/src/testsupport/large-session.ts'), dir, String(bytes)],
    { maxBuffer: 1024 * 1024 },
  )
  return JSON.parse(stdout) as { path: string; bytes: number; turns: number; longOutputs: number }
}
