import type { Page } from '@playwright/test'
import type { Server } from '../cli-process.ts'
import type { E2eContext } from './global-setup.ts'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { test as base, expect } from '@playwright/test'
import { openedUrls, start, waitFor } from '../cli-process.ts'
import { CONTEXT_ENV } from './global-setup.ts'

export { expect }

export interface Launched {
  /** `http://localhost:<port>/__agent-trace/`. */
  base: string
  /** The launch session's ref, when a path was given. */
  ref?: string
  /** URLs the fake opener received (auth on: they carry the one-time code). */
  opened: () => string[]
  /** The server's working directory ("Export report" writes here). */
  cwd: string
  output: () => { stdout: string, stderr: string }
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
  if (!raw)
    throw new Error(`${CONTEXT_ENV} is not set; run through playwright.config.ts`)
  return JSON.parse(raw) as E2eContext
}

export const ctx = readContext()

let runs = 0

/** A user's environment: the synthetic home, a fresh cache, the fake opener first on `PATH`, no color overrides. */
function cliEnv(home: string, cache: string, openLog: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_CACHE_HOME: cache,
    PATH: `${ctx.fakeBin}:${process.env.PATH ?? ''}`,
    AGENT_TRACE_SMOKE_OPEN_LOG: openLog,
    npm_config_update_notifier: 'false',
    ...extra,
  }
  for (const name of ['NO_COLOR', 'FORCE_COLOR', 'AGENT_TRACE_PATH', ...(extra.AGENT_TRACE_REDACT ? [] : ['AGENT_TRACE_REDACT'])])
    delete env[name]
  return env
}

export const test = base.extend<Fixtures>({
  consoleErrors: [async ({ context }, use) => {
    const errors: string[] = []
    context.on('console', (message) => {
      if (message.type() === 'error')
        errors.push(`console: ${message.text()}`)
    })
    context.on('weberror', error => errors.push(`page error: ${error.error().message}`))
    await use(errors)
    expect(errors, 'console errors').toEqual([])
  }, { auto: true }],

  launch: async ({ browserName: _browserName }, use) => {
    const servers: Server[] = []
    await use(async (options = {}) => {
      runs += 1
      const cwd = await mkdtemp(join(ctx.root, `run-${runs}-`))
      const cache = join(cwd, 'cache')
      await mkdir(cache, { recursive: true })
      const openLog = join(cwd, 'opened.log')
      const server = start(process.execPath, [ctx.bin, ...(options.args ?? []), '--port', '0'], {
        cwd,
        env: cliEnv(options.home ?? ctx.homes.main, cache, openLog, options.env),
      })
      servers.push(server)
      const ready = () => READY.exec(server.output().stdout)
      await waitFor('the Ready line', () => ready() !== null && (!options.waitOpened || openedUrls(openLog).length > 0), 30_000)
        .catch((error: Error) => {
          throw new Error(`${error.message}\nstdout:\n${server.output().stdout}\nstderr:\n${server.output().stderr}`)
        })
      const match = ready()!
      return { base: match[1]!, ref: match[2], opened: () => openedUrls(openLog), cwd, output: server.output }
    })
    for (const server of servers)
      await server.stop()
  },
})

/** The dev server with auth off and no browser opener, showing `path`'s workspace. */
export async function openWorkspace(page: Page, launch: Fixtures['launch'], path: string, options: Omit<LaunchOptions, 'args'> = {}): Promise<Launched> {
  const server = await launch({ ...options, args: [path, '--no-auth', '--no-open'] })
  await page.goto(`${server.base}#/s/${server.ref}`)
  await expect(page.getByTestId('ledger')).toBeVisible()
  return server
}

/** Visible text of the open inspector tab panel. */
export function activePanel(page: Page) {
  return page.locator('[role=tabpanel]:not([hidden])')
}
