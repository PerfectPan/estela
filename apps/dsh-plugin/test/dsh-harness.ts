import { chromium, type Browser } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))
const packJsonSchema = z.object({ filename: z.string() })

export interface RunningDsh {
  readonly pid: number
  readonly url: string
  readonly port: number
  readonly token: string
  output(): string
  stop(): Promise<void>
}

interface ProcessTrackerState {
  readonly activeDsh: Set<RunningDsh>
  readonly activeChildren: Set<ChildProcess>
  readonly trackedPids: Set<number>
}

function buildIsolatedEnv(homeDir: string, extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value === undefined
      || /_API_KEY$/i.test(key)
      || key === 'ESTELA_REDACT'
      || key.startsWith('DSH_')
      || key.toLowerCase().startsWith('npm_config_')
    ) {
      continue
    }
    env[key] = value
  }
  return Object.assign(
    env,
    {
      HOME: homeDir,
      USERPROFILE: homeDir,
      XDG_CONFIG_HOME: join(homeDir, '.config'),
      XDG_CACHE_HOME: join(homeDir, '.cache'),
      npm_config_cache: join(homeDir, '.npm-cache'),
      npm_config_userconfig: join(homeDir, '.npmrc'),
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
    extra,
  )
}

export function createDshEnv(
  dshHome: string,
  fakeHome: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return buildIsolatedEnv(fakeHome, { DSH_HOME: dshHome, ...extra })
}

async function waitForPidExit(pid: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 50))
  }
  throw new Error(`process ${pid} did not exit within ${timeoutMs}ms`)
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>(resolveExit => {
      let hardTimer: ReturnType<typeof setTimeout> | undefined
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL')
        }
      }, 5_000)
      const done = () => {
        clearTimeout(killTimer)
        if (hardTimer !== undefined) {
          clearTimeout(hardTimer)
        }
        resolveExit()
      }
      hardTimer = setTimeout(() => {
        child.off('exit', done)
        done()
      }, 12_000)
      child.once('exit', done)
      child.kill('SIGTERM')
    })
  }
  if (child.pid !== undefined) {
    await waitForPidExit(child.pid)
  }
}

interface SpawnCaptureOptions {
  readonly env: Record<string, string>
  readonly cwd?: string
  readonly timeoutMs: number
  readonly tracker?: ProcessTrackerState
}

function spawnCapture(
  cmd: string,
  args: readonly string[],
  options: SpawnCaptureOptions,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveCmd, rejectCmd) => {
    // Use `child_process.spawn` directly with `options.env` so parent env vars are never merged back in.
    const child = spawn(cmd, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (options.tracker) {
      options.tracker.activeChildren.add(child)
      if (child.pid !== undefined) {
        options.tracker.trackedPids.add(child.pid)
      }
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    const timer = setTimeout(() => {
      timedOut = true
      void terminateChild(child)
    }, options.timeoutMs)

    const finish = (err: Error | null, exitCode: number) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      options.tracker?.activeChildren.delete(child)
      if (err) {
        rejectCmd(err)
        return
      }
      if (timedOut) {
        rejectCmd(
          new Error(
            `${cmd} ${args.join(' ')} timed out after ${options.timeoutMs}ms:\n${stdout.slice(-2000)}${stderr.slice(-2000)}`,
          ),
        )
        return
      }
      resolveCmd({ exitCode, stdout, stderr })
    }

    child.on('error', err => finish(err, 1))
    child.on('close', code => finish(null, code ?? 1))
  })
}

export async function listListeningPorts(pid: number): Promise<string[]> {
  const env = buildIsolatedEnv(dirname(pluginDir))
  try {
    const lsof = await spawnCapture('lsof', ['-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-nP'], {
      env,
      timeoutMs: 10_000,
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
    const ss = await spawnCapture('ss', ['-ltnp'], { env, timeoutMs: 10_000 })
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

async function assertNoListeningPorts(pids: Iterable<number>): Promise<void> {
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

export class ProcessTracker implements ProcessTrackerState {
  readonly activeDsh = new Set<RunningDsh>()
  readonly activeChildren = new Set<ChildProcess>()
  readonly trackedPids = new Set<number>()

  async cleanupAll(): Promise<void> {
    const stops = [...this.activeDsh].map(async instance => {
      try {
        await instance.stop()
      } finally {
        this.activeDsh.delete(instance)
      }
    })
    await Promise.allSettled(stops)

    const kills = [...this.activeChildren].map(async child => {
      await terminateChild(child)
      this.activeChildren.delete(child)
    })
    await Promise.allSettled(kills)

    for (const pid of this.trackedPids) {
      await waitForPidExit(pid)
    }
    await assertNoListeningPorts(this.trackedPids)
  }
}

export async function launchChromium(): Promise<Browser> {
  const channel = process.env.ESTELA_E2E_CHANNEL
  if (channel) {
    return chromium.launch({ channel, headless: true })
  }
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    if (process.env.CI) {
      throw error
    }
    return chromium.launch({ channel: 'chrome', headless: true })
  }
}

export async function installDsh(
  prefixDir: string,
  version: string,
  npmHomeDir: string,
  tracker: ProcessTracker,
): Promise<string> {
  await mkdir(prefixDir, { recursive: true })
  await mkdir(npmHomeDir, { recursive: true })
  const proc = await spawnCapture(
    'npm',
    ['i', '--prefix', prefixDir, `@deepseek-ai/dsh@${version}`, '--registry', 'https://registry.npmjs.org/'],
    {
      env: buildIsolatedEnv(npmHomeDir),
      timeoutMs: 180_000,
      tracker,
    },
  )
  if (proc.exitCode !== 0) {
    throw new Error(
      `npm install @deepseek-ai/dsh@${version} failed (exit ${proc.exitCode}):\n${proc.stdout.slice(-4000)}${proc.stderr.slice(-4000)}`,
    )
  }
  return join(prefixDir, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
}

export async function packPlugin(outDir: string, npmHomeDir: string, tracker: ProcessTracker): Promise<string> {
  await mkdir(outDir, { recursive: true })
  await mkdir(npmHomeDir, { recursive: true })
  const proc = await spawnCapture('pnpm', ['pack', '--json', '--pack-destination', outDir], {
    cwd: pluginDir,
    env: buildIsolatedEnv(npmHomeDir),
    timeoutMs: 60_000,
    tracker,
  })
  if (proc.exitCode !== 0) {
    throw new Error(`pnpm pack failed (exit ${proc.exitCode}):\n${proc.stdout}${proc.stderr}`)
  }
  const parsed = z.parse(packJsonSchema, JSON.parse(proc.stdout))
  return parsed.filename
}

export async function repackWithEnginesDsh(
  tarballPath: string,
  enginesDsh: string,
  outDir: string,
  tracker: ProcessTracker,
): Promise<string> {
  const work = await mkdtemp(join(outDir, 'repack-'))
  const env = buildIsolatedEnv(work)
  const unpack = await spawnCapture('tar', ['-xzf', tarballPath, '-C', work], {
    env,
    timeoutMs: 30_000,
    tracker,
  })
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
  const repack = await spawnCapture('tar', ['-czf', dest, '-C', work, 'package'], {
    env,
    timeoutMs: 30_000,
    tracker,
  })
  if (repack.exitCode !== 0) {
    throw new Error(`tar repack failed: ${repack.stderr}`)
  }
  await rm(work, { recursive: true, force: true })
  return dest
}

export function runDshCli(
  dshBin: string,
  args: readonly string[],
  env: Record<string, string>,
  tracker: ProcessTracker,
  timeoutMs = 60_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return spawnCapture(process.execPath, [dshBin, ...args], { env, timeoutMs, tracker })
}

export async function startDshWeb(
  dshBin: string,
  env: Record<string, string>,
  tracker: ProcessTracker,
): Promise<RunningDsh> {
  const child = spawn(
    process.execPath,
    [dshBin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const pid = child.pid
  if (pid === undefined) {
    throw new Error('failed to spawn dsh web process')
  }
  tracker.trackedPids.add(pid)
  tracker.activeChildren.add(child)

  let combined = ''
  child.stdout.on('data', (chunk: Buffer) => {
    combined += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    combined += chunk.toString('utf8')
  })
  child.once('exit', () => {
    tracker.activeChildren.delete(child)
  })

  const stop = async (): Promise<void> => {
    await terminateChild(child)
    tracker.activeChildren.delete(child)
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
  const instance: RunningDsh = {
    pid,
    url,
    port: Number(parsed.port),
    token: parsed.searchParams.get('token') ?? '',
    output: () => combined,
    stop: async () => {
      try {
        await stop()
      } finally {
        tracker.activeDsh.delete(instance)
      }
    },
  }
  tracker.activeDsh.add(instance)
  return instance
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
