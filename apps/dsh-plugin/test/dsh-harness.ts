import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { x } from 'tinyexec'
import * as z from 'zod/mini'

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))
const e2ePlaywrightEntry = pathToFileURL(join(dirname(pluginDir), 'e2e/node_modules/@playwright/test/index.mjs')).href

const packJsonSchema = z.object({ filename: z.string() })
const workspaceStorageSchema = z.object({
  tables: z.object({
    workspaces: z.record(z.string(), z.object({ path: z.string() })),
  }),
})

interface SmokeLocator {
  first(): SmokeLocator
  nth(index: number): SmokeLocator
  locator(selector: string): SmokeLocator
  filter(options: { hasText: RegExp | string }): SmokeLocator
  count(): Promise<number>
  click(options?: { force?: boolean; timeout?: number }): Promise<void>
  waitFor(options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>
  allTextContents(): Promise<string[]>
  textContent(): Promise<string | null>
}

interface SmokeRoute {
  abort(errorCode?: string): Promise<void>
}

export interface SmokePage {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<unknown>
  reload(options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  locator(selector: string): SmokeLocator
  getByRole(role: string, options?: { name?: RegExp | string; exact?: boolean }): SmokeLocator
  getByText(text: RegExp | string, options?: { exact?: boolean }): SmokeLocator
  getByTestId(id: string): SmokeLocator
  evaluate<R, A = undefined>(fn: (arg: A) => R, arg?: A): Promise<R>
  route(url: string, handler: (route: SmokeRoute) => Promise<void> | void): Promise<void>
  unroute(url: string): Promise<void>
  on(event: 'console', listener: (msg: { type(): string; text(): string }) => void): void
  on(event: 'pageerror', listener: (error: Error) => void): void
  close(): Promise<void>
}

export interface SmokeContext {
  newPage(): Promise<SmokePage>
  cookies(): Promise<Array<{ name: string; value: string }>>
  close(): Promise<void>
}

export interface SmokeBrowser {
  newContext(options?: { viewport?: { width: number; height: number }; locale?: string }): Promise<SmokeContext>
  close(): Promise<void>
}

interface BrowserType {
  launch(options: { headless?: boolean; channel?: string }): Promise<SmokeBrowser>
}

// Keep `chromium` as a `z.custom` class instance so `z.parse` preserves `BrowserType`'s prototype.
const playwrightModuleSchema = z.object({
  chromium: z.custom<BrowserType>(
    value => value instanceof Object && typeof Reflect.get(value, 'launch') === 'function',
  ),
})

export async function launchChromium(): Promise<SmokeBrowser> {
  const loaded: unknown = await import(e2ePlaywrightEntry)
  const mod = z.parse(playwrightModuleSchema, loaded)
  const channel = process.env.ESTELA_E2E_CHANNEL
  if (channel) {
    return mod.chromium.launch({ channel, headless: true })
  }
  try {
    return await mod.chromium.launch({ headless: true })
  } catch (error) {
    if (process.env.CI) {
      throw error
    }
    return mod.chromium.launch({ channel: 'chrome', headless: true })
  }
}

export function createDshEnv(
  dshHome: string,
  fakeHome: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  const realHome = process.env.HOME ?? tmpdir()
  env.DSH_HOME = dshHome
  env.HOME = fakeHome
  env.npm_config_cache = process.env.npm_config_cache ?? join(realHome, '.npm')
  delete env.DEEPSEEK_API_KEY
  delete env.OPENAI_API_KEY
  delete env.ANTHROPIC_API_KEY
  if (extra) {
    Object.assign(env, extra)
  }
  return env
}

export async function installDsh(prefixDir: string, version: string): Promise<string> {
  await mkdir(prefixDir, { recursive: true })
  const proc = await x(
    'npm',
    ['i', '--prefix', prefixDir, `@deepseek-ai/dsh@${version}`, '--registry', 'https://registry.npmjs.org/'],
    {
      nodeOptions: { env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } },
      nodePath: false,
      throwOnError: false,
    },
  )
  if (proc.exitCode !== 0) {
    throw new Error(
      `npm install @deepseek-ai/dsh@${version} failed (exit ${proc.exitCode}):\n${proc.stdout.slice(-4000)}${proc.stderr.slice(-4000)}`,
    )
  }
  return join(prefixDir, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
}

export async function packPlugin(outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true })
  const proc = await x('pnpm', ['pack', '--json', '--pack-destination', outDir], {
    nodeOptions: { cwd: pluginDir },
    nodePath: false,
    throwOnError: false,
  })
  if (proc.exitCode !== 0) {
    throw new Error(`pnpm pack failed (exit ${proc.exitCode}):\n${proc.stdout}${proc.stderr}`)
  }
  const parsed = z.parse(packJsonSchema, JSON.parse(proc.stdout))
  return parsed.filename
}

export async function repackWithEnginesDsh(tarballPath: string, enginesDsh: string, outDir: string): Promise<string> {
  const work = await mkdtemp(join(outDir, 'repack-'))
  const unpack = await x('tar', ['-xzf', tarballPath, '-C', work], { nodePath: false, throwOnError: false })
  if (unpack.exitCode !== 0) {
    throw new Error(`tar extract failed: ${unpack.stderr}`)
  }
  const pkgPath = join(work, 'package', 'package.json')
  const pkg = z.parse(
    z.looseObject({ engines: z.looseObject({ dsh: z.string() }) }),
    JSON.parse(await readFile(pkgPath, 'utf8')),
  )
  pkg.engines.dsh = enginesDsh
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  const dest = join(outDir, 'incompatible-dsh-estela.tgz')
  const repack = await x('tar', ['-czf', dest, '-C', work, 'package'], { nodePath: false, throwOnError: false })
  if (repack.exitCode !== 0) {
    throw new Error(`tar repack failed: ${repack.stderr}`)
  }
  await rm(work, { recursive: true, force: true })
  return dest
}

export async function runDshCli(
  dshBin: string,
  args: readonly string[],
  env: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = await x(process.execPath, [dshBin, ...args], {
    nodeOptions: { env },
    nodePath: false,
    throwOnError: false,
  })
  return { exitCode: proc.exitCode ?? 1, stdout: proc.stdout, stderr: proc.stderr }
}

export interface RunningDsh {
  readonly pid: number
  readonly url: string
  readonly port: number
  readonly token: string
  output(): string
  stop(): Promise<void>
}

export async function startDshWeb(
  dshBin: string,
  env: Record<string, string>,
  trackedPids: Set<number>,
): Promise<RunningDsh> {
  const child: ChildProcess = spawn(
    process.execPath,
    [dshBin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const pid = child.pid
  if (pid === undefined) {
    throw new Error('failed to spawn dsh web process')
  }
  trackedPids.add(pid)

  let combined = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    combined += chunk.toString('utf8')
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    combined += chunk.toString('utf8')
  })

  const stop = async (): Promise<void> => {
    if (child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise<void>(resolveStop => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL')
          resolveStop()
        }, 5_000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolveStop()
        })
      })
    }
  }

  let url = ''
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const match = /http:\/\/127\.0\.0\.1:\d+[^\s]*/.exec(combined)
    if (match) {
      url = match[0]
      break
    }
    if (child.exitCode !== null) {
      throw new Error(`dsh web exited early (${child.exitCode}):\n${combined}`)
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 150))
  }
  if (!url) {
    await stop()
    throw new Error(`timed out waiting for dsh web loopback URL:\n${combined}`)
  }

  const parsed = new URL(url)
  return {
    pid,
    url,
    port: Number(parsed.port),
    token: parsed.searchParams.get('token') ?? '',
    output: () => combined,
    stop,
  }
}

export async function readWorkspacePath(dshHome: string): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(join(dshHome, 'storages/workspace.json'), 'utf8'))
  const storage = z.parse(workspaceStorageSchema, raw)
  const first = Object.values(storage.tables.workspaces)[0]
  if (!first) {
    throw new Error(`no workspace entry found in ${join(dshHome, 'storages/workspace.json')}`)
  }
  return first.path
}

export async function dismissNotices(page: SmokePage): Promise<void> {
  await page
    .getByRole('button', { name: /continue|继续/i })
    .first()
    .click({ force: true, timeout: 4_000 })
    .catch(() => {})
  await page.waitForTimeout(600)
  const signIn = page.locator('[role=presentation]').filter({ hasText: /get started|开始使用/i })
  if ((await signIn.count()) > 0) {
    await signIn
      .first()
      .locator('button')
      .first()
      .click({ force: true, timeout: 4_000 })
      .catch(() => {})
    await page.waitForTimeout(600)
  }
}

export interface HttpResponse {
  status: number
  ms: number
  text: string
  headers: http.IncomingHttpHeaders
}

function httpRequest(
  port: number,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolveReq, rejectReq) => {
    const started = performance.now()
    const body = options.body
    const headers: Record<string, string> = { ...options.headers }
    if (body !== undefined && !headers['content-length']) {
      headers['content-length'] = String(Buffer.byteLength(body))
    }
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        resolveReq({
          status: res.statusCode ?? 0,
          ms: performance.now() - started,
          text: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        })
      })
    })
    req.on('error', rejectReq)
    req.end(body)
  })
}

export function rpcPost(
  port: number,
  channel: string,
  endpoint: string,
  payload: unknown,
  options: { cookie?: string; headers?: Record<string, string> } = {},
): Promise<HttpResponse> {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: `smoke-${Math.random().toString(36).slice(2)}`,
    method: endpoint,
    payload,
  })
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers,
  }
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie
  }
  return httpRequest(port, 'POST', `${channel}/${endpoint}`, { headers, body })
}

export async function listListeningPorts(pid: number): Promise<string[]> {
  try {
    const lsof = await x('lsof', ['-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-nP'], {
      nodePath: false,
      throwOnError: false,
    })
    return lsof.stdout
      .split('\n')
      .slice(1)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const match = /TCP\s+(\S+)\s+\(LISTEN\)/.exec(line)
        return match ? match[1]! : line
      })
      .toSorted()
  } catch {
    // Fall back to `ss` on minimal Linux images where `lsof` is not installed.
  }
  try {
    const ss = await x('ss', ['-ltnp'], { nodePath: false, throwOnError: false })
    if (ss.exitCode === 0) {
      return ss.stdout
        .split('\n')
        .filter(line => line.includes(`pid=${pid},`))
        .map(line => line.trim().split(/\s+/)[3] ?? line)
        .toSorted()
    }
  } catch {
    return []
  }
  return []
}

export async function assertNoListeningPorts(pids: Iterable<number>): Promise<void> {
  const remaining: string[] = []
  for (const pid of pids) {
    const ports = await listListeningPorts(pid)
    if (ports.length > 0) {
      remaining.push(`pid ${pid}: ${ports.join(', ')}`)
    }
  }
  if (remaining.length > 0) {
    throw new Error(`dsh processes left listening sockets open: ${remaining.join('; ')}`)
  }
}
