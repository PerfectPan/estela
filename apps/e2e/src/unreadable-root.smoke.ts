import { chmod, cp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { openLogPath, smokeEnv, start, waitFor, type CliHome, type Server } from './cli-process.ts'
import { mcpClient, sessions } from './mcp-client.ts'
import { repo } from './prepare-run.ts'

const ctx = inject('smoke')

const warning = (syscall: 'stat' | 'scandir'): string =>
  `Session folder unreadable: Claude Code ~/.claude/projects (EACCES: permission denied, ${syscall} '~/.claude/projects'); `
  + 'its sessions could not be read. '
  + 'Check that your user has read permission (r) on this folder and enter permission (x) on it and on the folders above it.'

const protocolMessage = z.object({ jsonrpc: z.string() })

/** `Ready: <url>#/`. No session is launched, so `readyUrl`, which reads a launched session's id, does not match. */
function ready(output: { stdout: string }): boolean {
  return output.stdout.includes('Ready: http://localhost:') && output.stdout.includes('/__estela/#/\n')
}

/**
 * A home with one Grok session and a Claude Code folder Estela cannot read, as with mode 000: `~/.claude`, so the
 * root's `stat` fails, or the root `~/.claude/projects` itself, so listing it fails.
 */
async function unreadableClaudeHome(name: 'home' | 'root'): Promise<{ where: CliHome; locked: string }> {
  const home = join(ctx.root, `unreadable-${name}`)
  const projects = join(home, '.claude/projects')
  await mkdir(projects, { recursive: true })
  await cp(join(repo, 'fixtures/sessions/grok/conformance/plain'), join(home, '.grok/sessions/plain'), {
    recursive: true,
  })
  const locked = name === 'home' ? join(home, '.claude') : projects
  await chmod(locked, 0o000)
  return {
    where: { home, cache: join(ctx.root, `unreadable-${name}-cache`), fakeBin: ctx.fakeBin, node: ctx.node },
    locked,
  }
}

/** No line of the run shows the home directory, and none the failure that used to end the start. */
function expectRedacted(output: { stdout: string; stderr: string }, home: string): void {
  const text = `${output.stdout}${output.stderr}`
  expect(text).not.toContain(home)
  expect(text).not.toContain('Could not index sessions')
  expect(text).not.toContain('--no-index')
}

// chmod cannot make a folder unreadable on Windows, nor for a user (root) the mode bits do not stop.
const cannotLock = process.platform === 'win32' || process.getuid?.() === 0

describe.skipIf(cannotLock)('#171: one agent folder that cannot be read', () => {
  let home: CliHome
  const locked: string[] = []
  const servers: Server[] = []
  const launch = (where: CliHome, args: string[], options: { input?: boolean } = {}) => {
    const server = start(ctx.node, [ctx.bin, ...args], {
      cwd: ctx.installDir,
      env: smokeEnv(where, openLogPath(ctx, `unreadable-${servers.length}`)),
      ...options,
    })
    servers.push(server)
    return server
  }

  beforeAll(async () => {
    home = (await unreadableClaudeHome('home')).where
    locked.push(join(home.home, '.claude'))
  })

  afterAll(async () => {
    // The permissions first, on their own: a server that fails to stop must not leave a mode 000 folder behind.
    try {
      // Settled: one folder that cannot be restored must not keep the others at mode 000.
      await Promise.allSettled(locked.map(dir => chmod(dir, 0o700)))
    } finally {
      for (const server of servers) {
        await server.stop()
      }
    }
  })

  it('the dev server starts without the index and lists the other agents, saying that folder', async () => {
    const server = launch(home, ['--no-open', '--no-index', '--port', '0'])
    await waitFor(
      'the Ready line and the warning',
      () => ready(server.output()) && server.output().stderr.includes(warning('stat')),
    )
    const output = server.output()
    expect(output.stdout).toMatch(/^Grok: 1\/1 files read$/m)
    expect(output.stdout).toContain('Claude Code: 0 files, could not read ~/.claude/projects\n')
    expectRedacted(output, home.home)
  })

  it('the dev server starts from the index too, and says that folder once its pass is done', async () => {
    // The first launch fills the index; the second serves its rows at once and discovers behind the Ready line.
    const filling = launch(home, ['--no-open', '--port', '0'])
    await waitFor('the Ready line', () => ready(filling.output()))
    await filling.stop()
    const server = launch(home, ['--no-open', '--port', '0'])
    await waitFor(
      'the Ready line and the warning of the pass behind it',
      () => ready(server.output()) && server.output().stderr.includes(warning('stat')),
    )
    expect(server.output().stdout).toContain('Grok: 1 sessions from the index')
    expectRedacted(server.output(), home.home)
  })

  it('mcp starts over the session catalog, serves the sessions it can read, and keeps stdout to the protocol', async () => {
    const server = launch(home, ['mcp'], { input: true })
    await waitFor('the MCP server and its warning', () => {
      const { stderr } = server.output()
      return (
        stderr.includes('[devframe]') && stderr.includes('session folder unreadable: Claude Code ~/.claude/projects')
      )
    })
    // Nothing was asked yet: stdout is empty, and the warning is on stderr.
    expect(server.output().stdout).toBe('')
    expect(server.output().stderr).toContain(
      `estela: session folder unreadable: ${warning('stat').replace(/^Session folder unreadable: /, '')}`,
    )
    const client = mcpClient(server)
    await client.initialize()
    const listed = await client.call('estela_list_sessions', { agent: 'grok' })
    expect(listed.isError).toBe(false)
    expect(z.parse(sessions, JSON.parse(listed.text)).sessions).toHaveLength(1)
    // Every stdout line is a JSON-RPC message, and stderr has no escape sequences.
    for (const line of client.lines()) {
      expect(z.parse(protocolMessage, JSON.parse(line)).jsonrpc, line).toBe('2.0')
    }
    expect(server.output().stderr).not.toContain('\u001B')
    expectRedacted(server.output(), home.home)
  })

  it('the dev server says a session folder it cannot list, where the folder above it can be read', async () => {
    const { where, locked: dir } = await unreadableClaudeHome('root')
    locked.push(dir)
    const server = launch(where, ['--no-open', '--no-index', '--port', '0'])
    await waitFor(
      'the Ready line and the warning',
      () => ready(server.output()) && server.output().stderr.includes(warning('scandir')),
    )
    const output = server.output()
    expect(output.stdout).toMatch(/^Grok: 1\/1 files read$/m)
    expect(output.stdout).toContain('Claude Code: 0 files, could not read ~/.claude/projects\n')
    expectRedacted(output, where.home)
  })
})
