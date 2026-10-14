import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'

const cliDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(cliDir, '../..')
const demo = join(repoRoot, 'fixtures/demo.trace.json')
const webDir = join(repoRoot, 'apps/web')

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.NO_COLOR
  return env
}

function run(command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
    child.on('error', reject)
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }))
    child.stdin.end()
  })
}

async function ensureWebDist(): Promise<void> {
  if (existsSync(join(webDir, 'dist/index.html'))) {
    return
  }
  const vp = join(webDir, 'node_modules/.bin/vp')
  const { code, stderr } = await run(vp, ['build'], webDir)
  if (code !== 0) {
    throw new Error(stderr)
  }
}

async function treeContains(dir: string, needle: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (await treeContains(path, needle)) {
        return true
      }
      continue
    }
    const text = await readFile(path)
    if (text.includes(needle)) {
      return true
    }
  }
  return false
}

function mcpMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`
}

describe('cli smoke', () => {
  it('build reads the session once and writes portable output without escape sequences', async () => {
    await ensureWebDist()
    const outDir = await mkdtemp(join(tmpdir(), 'at-m4a-build-'))
    // Counts full reads of the demo file in the child process: the platform reads through
    // `createReadStream`, and only the whole-file read has no `end` bound (the canonical
    // head check reads 4 KB).
    const counter = [
      `import fs from 'node:fs'`,
      `import { syncBuiltinESMExports } from 'node:module'`,
      `let reads = 0`,
      `const createReadStream = fs.createReadStream`,
      `fs.createReadStream = function (path, opts) { if (String(path).endsWith('demo.trace.json') && !(opts && 'end' in opts)) reads += 1; return createReadStream.call(this, path, opts) }`,
      `syncBuiltinESMExports()`,
      `process.on('exit', () => process.stderr.write('full-reads=' + reads + '\\n'))`,
    ].join('\n')
    try {
      const preload = `data:text/javascript,${encodeURIComponent(counter)}`
      const result = await run(
        process.execPath,
        ['--import', preload, 'bin.mjs', 'build', demo, '--out-dir', outDir],
        cliDir,
      )
      expect(result.code).toBe(0)
      expect(result.stderr).toContain('full-reads=1\n')
      expect(result.stdout).not.toContain('\u001b')
      expect(result.stdout).toContain('Load:')
      expect(result.stdout).toContain('Write:')
      expect(await treeContains(outDir, homedir())).toBe(false)
      expect(await treeContains(outDir, repoRoot)).toBe(false)
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })

  it('S10: mcp reconstruct returns completeness and stdout stays protocol', async () => {
    const request = [
      mcpMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'agent-trace-smoke', version: '0.0.0' },
        },
      }),
      mcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      mcpMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'agent-trace_reconstruct', arguments: { eventId: 'e6' } },
      }),
    ].join('')
    const child = spawn(process.execPath, ['bin.mjs', 'mcp', demo], {
      cwd: cliDir,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = await new Promise<string>((resolve, reject) => {
      let buf = ''
      const timer = setTimeout(() => {
        child.kill()
        resolve(buf)
      }, 20000)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buf += chunk
        if (buf.includes('"id":2') && buf.includes('completeness')) {
          clearTimeout(timer)
          child.kill()
          resolve(buf)
        }
      })
      child.on('error', reject)
      child.stdin.write(request)
      child.stdin.end()
    })
    expect(stdout).toContain('"id":2')
    expect(stdout).toContain('completeness')
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }
      expect(() => JSON.parse(trimmed)).not.toThrow()
    }
  })
})
