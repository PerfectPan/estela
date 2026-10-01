import type { ChildProcess } from 'node:child_process'
import type { SmokeContext } from './global-setup.ts'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Where a CLI run lives: its `HOME`, its `XDG_CACHE_HOME`, and the directory with the fake opener. */
export interface CliHome {
  home: string
  cache: string
  fakeBin: string
}

/**
 * The environment a user has: synthetic `HOME`, a cache dir inside the run, the fake opener first
 * on `PATH`, no `NO_COLOR` / `FORCE_COLOR` / `AGENT_TRACE_*` from the caller, and no npm notices.
 * `extra` goes on top (for example `AGENT_TRACE_REDACT=0`).
 */
export function smokeEnv(where: CliHome, openLog: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of ['NO_COLOR', 'FORCE_COLOR', 'AGENT_TRACE_PATH', 'AGENT_TRACE_REDACT']) {
    delete env[name]
  }
  return {
    ...env,
    HOME: where.home,
    XDG_CACHE_HOME: where.cache,
    PATH: `${where.fakeBin}:${process.env.PATH ?? ''}`,
    AGENT_TRACE_SMOKE_OPEN_LOG: openLog,
    // A fresh HOME means a fresh npm update check; its notice would land in the output under test.
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    ...extra,
  }
}

/** URLs the fake opener recorded, in order. */
export function openedUrls(openLog: string): string[] {
  if (!existsSync(openLog)) {
    return []
  }
  return readFileSync(openLog, 'utf8')
    .split('\n')
    .filter(line => line.length > 0)
}

export function openLogPath(ctx: SmokeContext, name: string): string {
  return join(ctx.root, `opened-${name}.log`)
}

export function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = collect(child)
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 1, ...out() }))
  })
}

export interface Server {
  output: () => { stdout: string; stderr: string }
  /** Writes to stdin; only with `input: true`. */
  send: (text: string) => void
  stop: () => Promise<void>
}

/** A long-running CLI (dev server, MCP). `stop` ends stdin, sends SIGTERM, and waits for the exit. */
export function start(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; input?: boolean },
): Server {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  })
  const output = collect(child)
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()))
  return {
    output,
    send(text) {
      child.stdin!.write(text)
    },
    async stop() {
      child.stdin?.end()
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
      }
      await closed
    },
  }
}

function collect(child: ChildProcess): () => { stdout: string; stderr: string } {
  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })
  return () => ({ stdout, stderr })
}

export async function waitFor(what: string, check: () => boolean, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** `Ready: <base>#/s/<ref>` in plain output, or the URL inside the Ready box in a terminal. */
export function readyUrl(text: string): { base: string; ref: string } | undefined {
  const match = /(http:\/\/localhost:\d+\/__agent-trace\/)#\/s\/([0-9a-f]+)/.exec(text)
  return match ? { base: match[1]!, ref: match[2]! } : undefined
}
