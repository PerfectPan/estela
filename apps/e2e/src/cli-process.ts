import type { ChildProcess } from 'node:child_process'
import type { SmokeContext } from './global-setup.ts'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import process from 'node:process'
import { normalizeSpawnCommand } from 'tinyexec'
import { expect } from 'vite-plus/test'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Where a CLI run lives: its `HOME`, its `XDG_CACHE_HOME`, the directory with the fake opener, and
 * the Node.js that runs the CLI, whose directory goes on `PATH` so `npx` and npm's bin shims use it too.
 */
export interface CliHome {
  home: string
  cache: string
  fakeBin: string
  node: string
}

/**
 * The environment a user has: synthetic `HOME` (and `USERPROFILE`, which `os.homedir()` reads on
 * Windows), a cache dir inside the run, the fake opener and then the CLI's Node.js first on
 * `PATH`, no `NO_COLOR` / `FORCE_COLOR` / `ESTELA_*` from the caller, no agent home overrides (they
 * would point the tests at real sessions), and no npm notices. `extra` goes on top (for example
 * `ESTELA_REDACT=0`).
 */
export function smokeEnv(where: CliHome, openLog: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Windows spells it `Path`; a second `PATH` key next to it would leave the winner to key order.
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  for (const name of [
    'NO_COLOR',
    'FORCE_COLOR',
    'ESTELA_PATH',
    'ESTELA_REDACT',
    'ESTELA_MCP_TOKEN',
    'CLAUDE_CONFIG_DIR',
    'CODEX_HOME',
    'DSH_HOME',
    'GROK_HOME',
    'GEMINI_CLI_HOME',
    'PI_CODING_AGENT_DIR',
    'XDG_DATA_HOME',
  ]) {
    delete env[name]
  }
  return {
    ...env,
    HOME: where.home,
    USERPROFILE: where.home,
    XDG_CACHE_HOME: where.cache,
    [pathKey]: [where.fakeBin, dirname(where.node), env[pathKey] ?? ''].join(delimiter),
    ESTELA_SMOKE_OPEN_LOG: openLog,
    // A fresh HOME means a fresh npm update check; its notice would land in the output under test.
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    ...extra,
  }
}

/**
 * Whether the fake opener sees the CLI's browser launches. On Windows DevFrame starts
 * `cmd /c start`, which nothing on `PATH` can stand in for, so tests there pass {@link openArgs}
 * and check the printed URL only.
 */
export const fakeOpener = process.platform !== 'win32'

/** `--no-open` where the fake opener cannot catch the launch, so a test never starts a real browser. */
export const openArgs: readonly string[] = fakeOpener ? [] : ['--no-open']

/** URLs the fake opener recorded, in order. */
export function openedUrls(openLog: string): string[] {
  if (!existsSync(openLog)) {
    return []
  }
  return readFileSync(openLog, 'utf8')
    .split('\n')
    .filter(line => line.length > 0)
}

/** The fake opener recorded a URL, or cannot record one on this system. */
export function openSeen(openLog: string): boolean {
  return !fakeOpener || openedUrls(openLog).length > 0
}

export function openLogPath(ctx: SmokeContext, name: string): string {
  return join(ctx.root, `opened-${name}.log`)
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

/**
 * Runs `command` to its exit with exactly `options.env`. `normalizeSpawnCommand` turns a Windows
 * `.cmd` shim such as `npx` into a `cmd.exe` call with escaped arguments and leaves other commands
 * as they are; tinyexec's `x()` is not used here because it merges `process.env` back in.
 */
export function run(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const spawnable = normalizeSpawnCommand(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const child = spawn(spawnable.command, spawnable.args, spawnable.options)
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

export async function waitFor(what: string, check: () => boolean, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${what}`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/** `Ready: <base>#/s/<traceId>` in plain output, or the URL inside the Ready box in a terminal. */
export function readyUrl(text: string): { base: string; traceId: string } | undefined {
  const match = /(http:\/\/localhost:\d+\/__estela\/)#\/s\/([0-9a-f]+)/.exec(text)
  return match ? { base: match[1]!, traceId: match[2]! } : undefined
}

/** A smoke run's stdout is line-delimited JSON, and its stderr carries no ANSI escape. */
export function expectCleanOutput(lines: readonly string[], stderr: string): void {
  for (const line of lines) {
    expect(() => JSON.parse(line), line).not.toThrow()
  }
  expect(stderr).not.toContain('\u001B')
}

/** A non-internal IPv4 address of this machine, when it has one: how another machine on the LAN reaches it. */
export function lanAddress(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find(entry => entry?.family === 'IPv4' && !entry.internal)?.address
}
