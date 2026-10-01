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
  it('ships only dist, the README, the license, and the notices', () => {
    expect(ctx.files).toEqual(expect.arrayContaining(['LICENSE', 'README.md', 'package.json', 'dist/bin.mjs', 'dist/cli.mjs', 'dist/THIRD-PARTY-NOTICES.txt', 'dist/web/index.html', 'dist/fixtures/demo.trace.json']))
    expect(ctx.files.filter(file => !['LICENSE', 'README.md', 'package.json', 'CHANGELOG.md'].includes(file) && !file.startsWith('dist/'))).toEqual([])
  })

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
      await waitFor('the Ready line and the browser opener', () => readyUrl(server.output().stdout) !== undefined && openedUrls(log).length > 0)
      const ready = readyUrl(server.output().stdout)
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
    const server = start(process.execPath, [ctx.bin, 'mcp', ctx.claudePlain], { cwd: ctx.installDir, env: smokeEnv(ctx, openLogPath(ctx, 's10')), input: true })
    const send = (message: unknown) => server.send(`${JSON.stringify(message)}\n`)
    const lines = () => server.output().stdout.split('\n').filter(text => text.trim().length > 0)
    const response = async (id: number) => {
      await waitFor(`mcp response ${id}`, () => lines().some(line => line.includes(`"id":${id}`)))
      return JSON.parse(lines().find(line => line.includes(`"id":${id}`))!)
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
      await server.stop()
    }
    for (const line of lines())
      expect(() => JSON.parse(line), line).not.toThrow()
    expect(server.output().stderr).not.toContain('\u001B')
  })

  it('S13: Node 20 gets one line naming Node.js 22.18', async () => {
    const result = await run('npx', ['-y', 'node@20', ctx.bin, '--help'], { cwd: ctx.installDir, env: smokeEnv(ctx, openLogPath(ctx, 's13')) })
    expect(result.code).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toBe('agent-trace requires Node.js 22.18 or later.\n')
  })

  it('S15: build piped to a file writes plain lines and no home path', async () => {
    const outDir = join(ctx.root, 's15-report')
    // stdout is a pipe: like `> log.txt`, it is not a TTY.
    const result = await run(process.execPath, [ctx.bin, 'build', ctx.claudePlain, '--out-dir', outDir], { cwd: ctx.installDir, env: smokeEnv(ctx, openLogPath(ctx, 's15')) })
    const log = result.stdout
    expect(result.code, `${log}\n${result.stderr}`).toBe(0)
    expect(log).not.toContain('\u001B')
    expect(result.stderr).not.toContain('\u001B')
    expect(log).toContain('Load: 9 events')
    expect(log).toContain('Redact: redacted 9 events')
    expect(log).toContain(`Write: ${outDir}`)
    expect(await filesContaining(outDir, ctx.home)).toEqual([])
    expect(await filesContaining(outDir, homedir())).toEqual([])
    // The report is one file that opens from disk (plan D8).
    expect(await readdir(outDir)).toEqual(['index.html'])
  })
})
