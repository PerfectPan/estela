import { lookup } from 'node:dns/promises'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer, type Server as NetServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, inject, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import cliPackage from '../../cli/package.json' with { type: 'json' }
import { openedUrls, openLogPath, readyUrl, run, smokeEnv, start, waitFor } from './cli-process.ts'

const ctx = inject('smoke')

async function filesContaining(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) {
      continue
    }
    const path = join(entry.parentPath, entry.name)
    if ((await readFile(path)).includes(needle)) {
      hits.push(path)
    }
  }
  return hits
}

describe('installed tarball', () => {
  it('ships only dist, the README, the license, and the notices', () => {
    expect(ctx.files).toEqual(
      expect.arrayContaining([
        'LICENSE',
        'README.md',
        'package.json',
        'dist/bin.mjs',
        'dist/cli.mjs',
        'dist/THIRD-PARTY-NOTICES.txt',
        'dist/web/index.html',
        'dist/fixtures/demo.trace.json',
      ]),
    )
    expect(
      ctx.files.filter(
        file => !['LICENSE', 'README.md', 'package.json', 'CHANGELOG.md'].includes(file) && !file.startsWith('dist/'),
      ),
    ).toEqual([])
  })

  it('--help through npx', async () => {
    const result = await run('npx', ['--no-install', 'estela', '--help'], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 'help')),
    })
    expect(result.code).toBe(0)
    expect(result.stdout.split('\n')[0]).toBe(`estela ${cliPackage.version}`)
    expect(result.stdout).toContain('Usage:')
    expect(result.stdout).toContain('--pick')
    expect(result.stdout).toContain('export-otlp')
    expect(result.stderr).toBe('')
  })

  it('--version names the package version, and an unknown flag fails before any session is read', async () => {
    const env = smokeEnv(ctx, openLogPath(ctx, 'version'))
    const version = await run(process.execPath, [ctx.bin, '--version'], { cwd: ctx.installDir, env })
    expect(version.code).toBe(0)
    expect(version.stdout).toBe(`estela ${cliPackage.version}\n`)
    const unknown = await run(process.execPath, [ctx.bin, '--bogus', ctx.claudePlain], { cwd: ctx.installDir, env })
    expect(unknown.code).toBe(1)
    expect(unknown.stdout).toBe('')
    expect(unknown.stderr).toBe('unexpected: `--bogus`\nRun estela --help for usage.\n')
  })

  it("S2: a session path opens that session's workspace", async () => {
    const log = openLogPath(ctx, 's2')
    const server = start(process.execPath, [ctx.bin, ctx.claudePlain, '--port', '0'], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, log),
    })
    try {
      await waitFor(
        'the Ready line and the browser opener',
        () => readyUrl(server.output().stdout) !== undefined && openedUrls(log).length > 0,
      )
      const ready = readyUrl(server.output().stdout)
      expect(server.output().stdout).toContain(`Ready: ${ready!.base}#/s/${ready!.traceId}`)
      // The fragment carries DevFrame's one-time code, so the trace id rides `?s=`; the SPA moves it to `#/s/<traceId>`.
      const [opened] = openedUrls(log)
      expect(opened).toMatch(
        new RegExp(`^${ready!.base.replaceAll('/', '\\/')}\\?s=${ready!.traceId}#devframe_otp=\\w+$`),
      )
      expect(openedUrls(log)).toHaveLength(1)
      // The session index loads node:sqlite; `dist/bin.mjs` drops only its ExperimentalWarning.
      expect(server.output().stderr).not.toContain('ExperimentalWarning')
    } finally {
      await server.stop()
    }
  })

  it('without --port, a taken default port moves the server to a following port', async () => {
    // DevFrame binds every loopback address of `localhost` and probes only the first, so the case
    // that used to fail is the default port held on a later address. Hold it on all of them; an
    // address another process already holds is as good as one held here.
    const holders: NetServer[] = []
    for (const { address } of await lookup('localhost', { all: true })) {
      const holder = createServer()
      const held = await new Promise<boolean>(resolve => {
        holder.once('error', () => resolve(false))
        holder.listen(7392, address, () => resolve(true))
      })
      if (held) {
        holders.push(holder)
      }
    }
    const server = start(process.execPath, [ctx.bin, ctx.claudePlain], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 'port-fallback')),
    })
    try {
      await waitFor('the Ready line', () => readyUrl(server.output().stdout) !== undefined)
      const port = Number(new URL(readyUrl(server.output().stdout)!.base).port)
      expect(port).toBeGreaterThan(7392)
      expect(port).toBeLessThanOrEqual(7491)
    } finally {
      await server.stop()
      for (const holder of holders) {
        holder.close()
      }
    }
  })

  it('S10: mcp lists tools and reconstruct returns completeness', async () => {
    const server = start(process.execPath, [ctx.bin, 'mcp', ctx.claudePlain], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 's10')),
      input: true,
    })
    const send = (message: unknown) => server.send(`${JSON.stringify(message)}\n`)
    const lines = () =>
      server
        .output()
        .stdout.split('\n')
        .filter(text => text.trim().length > 0)
    const response = async (id: number) => {
      await waitFor(`mcp response ${id}`, () => lines().some(line => line.includes(`"id":${id}`)))
      return JSON.parse(lines().find(line => line.includes(`"id":${id}`))!)
    }
    try {
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'estela-smoke', version: '0.0.0' },
        },
      })
      expect((await response(1)).result.serverInfo.name).toContain('estela')
      send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const tools = (await response(2)).result.tools.map((tool: { name: string }) => tool.name)
      expect(tools).toContain('estela_reconstruct')
      send({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'estela_reconstruct', arguments: { eventId: 'a1' } },
      })
      const call = (await response(3)).result
      expect(call.isError).not.toBe(true)
      const surface = JSON.parse(call.content[0].text)
      expect(surface.eventId).toBe('a1')
      expect(surface.visibleIds).toContain('a1')
      expect(surface.unavailable).toEqual(['system', 'tools'])
      expect(surface.completeness).toBe('partial')
    } finally {
      await server.stop()
    }
    for (const line of lines()) {
      expect(() => JSON.parse(line), line).not.toThrow()
    }
    expect(server.output().stderr).not.toContain('\u001B')
  })

  it('S13: Node 22 gets one line naming Node.js 24', async () => {
    const result = await run('npx', ['-y', '--registry', ctx.registry, 'node@22', ctx.bin, '--help'], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 's13')),
    })
    expect(result.code).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toBe('estela requires Node.js 24 or later.\n')
  })

  it('S15: build piped to a file writes plain lines and no home path', async () => {
    const outDir = join(ctx.root, 's15-report')
    // stdout is a pipe: like `> log.txt`, it is not a TTY.
    const result = await run(process.execPath, [ctx.bin, 'build', ctx.claudePlain, '--out-dir', outDir], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 's15')),
    })
    const log = result.stdout
    expect(result.code, `${log}\n${result.stderr}`).toBe(0)
    expect(log).not.toContain('\u001B')
    expect(result.stderr).not.toContain('\u001B')
    expect(log).toContain('Load: 9 events')
    expect(log).toContain('Redact: redacted 9 events')
    expect(log).toContain(`Write: ${outDir}`)
    expect(await filesContaining(outDir, ctx.home)).toEqual([])
    expect(await filesContaining(outDir, homedir())).toEqual([])
    // The report is one file that opens from disk.
    expect(await readdir(outDir)).toEqual(['index.html'])
  })

  it('#125: --port on an already-bound port exits cleanly with code 1 and no stack trace', async () => {
    const holder = createServer()
    await new Promise<void>((resolve, reject) => {
      holder.once('error', reject)
      holder.listen(0, '127.0.0.1', () => resolve())
    })
    const { port } = z.object({ port: z.number() }).parse(holder.address())
    try {
      const result = await run(
        process.execPath,
        [ctx.bin, '--host', '127.0.0.1', '--port', String(port), '--no-open'],
        { cwd: ctx.installDir, env: smokeEnv(ctx, openLogPath(ctx, 'port-busy')) },
      )
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(`Port ${port} is already in use.`)
      expect(`${result.stdout}${result.stderr}`).not.toContain('DF0052')
      expect(`${result.stdout}${result.stderr}`).not.toContain('\n    at ')
    } finally {
      await new Promise<void>(resolve => holder.close(() => resolve()))
    }
  })

  it('#126: --host 127.0.0.1 prints and opens http://127.0.0.1:<port> even when [::1] holds that port', async () => {
    let v6Hits = 0
    const v6Holder = createHttpServer((_req, res) => {
      v6Hits += 1
      res.writeHead(200)
      res.end('wrong-server')
    })
    const v6Bound = await new Promise<boolean>(resolve => {
      v6Holder.once('error', () => resolve(false))
      v6Holder.listen(0, '::1', () => resolve(true))
    })
    let port: number
    if (v6Bound) {
      port = z.object({ port: z.number() }).parse(v6Holder.address()).port
    } else {
      const probe = createServer()
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject)
        probe.listen(0, '127.0.0.1', () => resolve())
      })
      port = z.object({ port: z.number() }).parse(probe.address()).port
      await new Promise<void>(resolve => probe.close(() => resolve()))
    }

    const log = openLogPath(ctx, 'host-v4-loopback')
    const server = start(process.execPath, [ctx.bin, '--host', '127.0.0.1', '--port', String(port)], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, log),
    })
    const readyPattern = new RegExp(`Ready: http://127\\.0\\.0\\.1:${port}/__estela/#/`)
    try {
      await waitFor(
        'the 127.0.0.1 Ready line and browser open',
        () => readyPattern.test(server.output().stdout) && openedUrls(log).length > 0,
      )
      const stdout = server.output().stdout
      expect(stdout).toContain(`http://127.0.0.1:${port}/__estela/#/`)
      expect(stdout).not.toContain(`http://localhost:${port}`)
      const opened = openedUrls(log)
      expect(opened).toHaveLength(1)
      expect(opened[0]).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/__estela/#devframe_otp=\\w+$`))

      const res = await fetch(`http://127.0.0.1:${port}/__estela/`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Estela')
      expect(v6Hits).toBe(0)

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/__estela/__ws`)
        ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')))
        ws.addEventListener('open', () => {
          ws.send(
            JSON.stringify({
              t: 'q',
              i: 'banner-check',
              m: 'anonymous:devframe:auth:request-code',
              a: [
                {
                  ua: 'Mozilla/5.0',
                  origin: `http://127.0.0.1:${port}\u001B]52;c;ZXY=\u0007\n│ auth code  000000`,
                },
              ],
            }),
          )
        })
        ws.addEventListener('message', () => {
          ws.close()
          resolve()
        })
      })

      await waitFor('sanitized auth banner on stdout', () =>
        server.output().stdout.includes(`http://127.0.0.1:${port}/__estela/#devframe_otp=`),
      )
      const bannerOut = server.output().stdout
      expect(bannerOut).not.toContain(`http://localhost:${port}`)
      expect(bannerOut).not.toContain('\u001B]52')
      const forgedCodeLines = bannerOut.split('\n').filter(line => line.includes('000000') && !line.includes('origin'))
      expect(forgedCodeLines).toHaveLength(0)
    } finally {
      await server.stop()
      if (v6Bound) {
        await new Promise<void>(resolve => v6Holder.close(() => resolve()))
      }
    }
  })

  it('#126 / M1: --host [::1] binds IPv6 loopback and prints and opens http://[::1]:<port>', async () => {
    const v6Probe = createServer()
    const v6Supported = await new Promise<boolean>(resolve => {
      v6Probe.once('error', () => resolve(false))
      v6Probe.listen(0, '::1', () => resolve(true))
    })
    if (!v6Supported) {
      return
    }
    const port = z.object({ port: z.number() }).parse(v6Probe.address()).port
    await new Promise<void>(resolve => v6Probe.close(() => resolve()))

    const log = openLogPath(ctx, 'host-v6-loopback')
    const server = start(process.execPath, [ctx.bin, '--host', '[::1]', '--port', String(port)], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, log),
    })
    const readyPattern = new RegExp(`Ready: http://\\[::1\\]:${port}/__estela/#/`)
    try {
      await waitFor(
        'the [::1] Ready line and browser open',
        () => readyPattern.test(server.output().stdout) && openedUrls(log).length > 0,
      )
      expect(server.output().stdout).toContain(`http://[::1]:${port}/__estela/#/`)
      const opened = openedUrls(log)
      expect(opened).toHaveLength(1)
      expect(opened[0]).toMatch(new RegExp(`^http://\\[::1\\]:${port}/__estela/#devframe_otp=\\w+$`))

      const res = await fetch(`http://[::1]:${port}/__estela/`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('Estela')
    } finally {
      await server.stop()
    }
  })

  it('refuses --no-auth with a non-loopback --host', async () => {
    const result = await run(process.execPath, [ctx.bin, '--no-auth', '--host', '0.0.0.0'], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 'no-auth-host')),
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--no-auth cannot be used with a non-loopback --host')
  })

  it('build --out-dir refuses non-empty directories while allowing rebuilds over an earlier report', async () => {
    const nonEmptyDir = join(ctx.root, 'build-non-empty')
    await mkdir(nonEmptyDir, { recursive: true })
    const keepFile = join(nonEmptyDir, 'keep.txt')
    await writeFile(keepFile, 'do-not-delete', 'utf8')

    const refused = await run(process.execPath, [ctx.bin, 'build', ctx.claudePlain, '--out-dir', nonEmptyDir], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 'build-nonempty')),
    })
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('Could not write build output:')
    expect(await readFile(keepFile, 'utf8')).toBe('do-not-delete')

    const reportDir = join(ctx.root, 'build-rebuild')
    const first = await run(process.execPath, [ctx.bin, 'build', ctx.claudePlain, '--out-dir', reportDir], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 'build-first')),
    })
    expect(first.code, first.stderr).toBe(0)

    const rebuild = await run(process.execPath, [ctx.bin, 'build', ctx.claudePlain, '--out-dir', reportDir], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 'build-second')),
    })
    expect(rebuild.code, rebuild.stderr).toBe(0)
    expect(await readdir(reportDir)).toEqual(['index.html'])

    const notDirChild = await run(
      process.execPath,
      [ctx.bin, 'build', ctx.claudePlain, '--out-dir', join(keepFile, 'nested')],
      {
        cwd: ctx.installDir,
        env: smokeEnv(ctx, openLogPath(ctx, 'build-enotdir')),
      },
    )
    expect(notDirChild.code).toBe(1)
    expect(notDirChild.stderr).toContain('Could not write build output:')
  })
})
