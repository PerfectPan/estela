import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, inject, it } from 'vitest'
import { openedUrls, openLogPath, readyUrl, run, smokeEnv, start, waitFor } from './cli-process.ts'

const ctx = inject('smoke')

async function filesContaining(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile())
      continue
    const path = join(entry.parentPath, entry.name)
    if ((await readFile(path)).includes(needle))
      hits.push(path)
  }
  return hits
}

describe('installed tarball', () => {
  it('--help through npx', async () => {
    const result = await run('npx', ['--no-install', 'agent-trace', '--help'], { cwd: ctx.installDir, env: smokeEnv(ctx, openLogPath(ctx, 'help')) })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('agent-trace/')
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('--pick')
    expect(result.stderr).toBe('')
  })

  it('S2: a session path opens that session\'s workspace', async () => {
    const log = openLogPath(ctx, 's2')
    const server = start(process.execPath, [ctx.bin, ctx.claudePlain, '--port', '0'], { cwd: ctx.installDir, env: smokeEnv(ctx, log) })
    try {
      await waitFor('the browser opener', () => openedUrls(log).length > 0)
      const ready = readyUrl(server.output().stdout)
      expect(ready, server.output().stdout).toBeDefined()
      expect(server.output().stdout).toContain(`Ready: ${ready!.base}#/s/${ready!.ref}`)
      // The fragment carries DevFrame's one-time code, so the ref rides `?s=`; the SPA moves it to `#/s/<ref>`.
      const [opened] = openedUrls(log)
      expect(opened).toMatch(new RegExp(`^${ready!.base.replaceAll('/', '\\/')}\\?s=${ready!.ref}#devframe_otp=\\w+$`))
      expect(openedUrls(log)).toHaveLength(1)
      // The session index loads node:sqlite; `dist/bin.mjs` drops only its ExperimentalWarning.
      expect(server.output().stderr).not.toContain('ExperimentalWarning')
    }
    finally {
      await server.stop()
    }
  })

  it('S10: mcp lists tools and reconstruct returns completeness', async () => {
    const child = spawn(process.execPath, [ctx.bin, 'mcp', ctx.claudePlain], { cwd: ctx.installDir, env: smokeEnv(ctx, openLogPath(ctx, 's10')), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`)
    const response = async (id: number) => {
      await waitFor(`mcp response ${id}`, () => stdout.split('\n').some(line => line.includes(`"id":${id}`)))
      return JSON.parse(stdout.split('\n').find(line => line.includes(`"id":${id}`))!)
    }
    try {
      send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent-trace-smoke', version: '0.0.0' } } })
      expect((await response(1)).result.serverInfo.name).toContain('agent-trace')
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const tools = (await response(2)).result.tools.map((tool: { name: string }) => tool.name)
      expect(tools).toContain('agent-trace_reconstruct')
      send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'agent-trace_reconstruct', arguments: { eventId: 'a1' } } })
      const call = (await response(3)).result
      expect(call.isError).not.toBe(true)
      const surface = JSON.parse(call.content[0].text)
      expect(surface.eventId).toBe('a1')
      expect(surface.visibleIds).toContain('a1')
      expect(surface.unavailable).toEqual(['system', 'tools'])
      expect(surface.completeness).toBe('partial')
    }
    finally {
      child.stdin.end()
      child.kill('SIGTERM')
      await new Promise(resolve => child.once('close', resolve))
    }
    for (const line of stdout.split('\n').filter(text => text.trim().length > 0))
      expect(() => JSON.parse(line), line).not.toThrow()
    expect(stderr).not.toContain('\u001B')
  })

  it('S13: Node 20 gets one line naming Node.js 22.18', async () => {
    const result = await run('npx', ['-y', 'node@20', ctx.bin, '--help'], { cwd: ctx.installDir, env: smokeEnv(ctx, openLogPath(ctx, 's13')) })
    expect(result.code).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toBe('agent-trace requires Node.js 22.18 or later.\n')
  })

  it('S15: build piped to a file writes plain lines and no home path', async () => {
    const logFile = join(ctx.root, 's15-log.txt')
    const outDir = join(ctx.root, 's15-report')
    const fd = openSync(logFile, 'w')
    let result
    try {
      result = await run(process.execPath, [ctx.bin, 'build', ctx.claudePlain, '--out-dir', outDir], { cwd: ctx.installDir, env: smokeEnv(ctx, openLogPath(ctx, 's15')), stdio: ['ignore', fd, 'pipe'] })
    }
    finally {
      closeSync(fd)
    }
    const log = await readFile(logFile, 'utf8')
    expect(result.code, `${log}\n${result.stderr}`).toBe(0)
    expect(log).not.toContain('\u001B')
    expect(result.stderr).not.toContain('\u001B')
    expect(log).toContain('Load: 9 events')
    expect(log).toContain('Redact: redacted 9 events')
    expect(log).toContain(`Write: ${outDir}`)
    expect(await filesContaining(outDir, ctx.home)).toEqual([])
    expect(await filesContaining(outDir, homedir())).toEqual([])
    expect((await readdir(outDir)).toSorted()).toEqual(expect.arrayContaining(['index.html', '__rpc-dump']))
  })
})
