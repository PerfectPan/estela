import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cliDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(cliDir, '../..')
const demo = join(repoRoot, 'fixtures/demo.trace.json')
const webDir = join(repoRoot, 'apps/web')

async function ensureWebDist(): Promise<void> {
  if (existsSync(join(webDir, 'dist/index.html')))
    return
  const vite = join(webDir, 'node_modules/.bin/vite')
  const { code, stderr } = await run(vite, ['build', '--config', join(webDir, 'src/vite.config.ts')], webDir)
  if (code !== 0)
    throw new Error(stderr)
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.NO_COLOR
  return env
}

function run(command: string, args: string[], cwd: string, stdin?: string): Promise<{ code: number, stdout: string, stderr: string }> {
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
    if (stdin !== undefined) {
      child.stdin.write(stdin)
      child.stdin.end()
    }
    else {
      child.stdin.end()
    }
  })
}

function mcpMessage(message: unknown): string {
  return `${JSON.stringify(message)}\n`
}

describe('cli smoke', () => {
  it('S15: build piped with NO_COLOR unset has no escape sequences', async () => {
    await ensureWebDist()
    const outDir = await mkdtemp(join(tmpdir(), 'at-m1-build-'))
    try {
      const result = await run(process.execPath, ['bin.mjs', 'build', demo, '--out-dir', outDir], cliDir)
      expect(result.code).toBe(0)
      expect(result.stdout).not.toContain('\u001b')
      expect(result.stdout).toContain('Load:')
      expect(result.stdout).toContain('Write:')
    }
    finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })

  it('S10: mcp tools/list returns reconstruct and stdout stays protocol', async () => {
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
      mcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    ].join('')
    const child = spawn(process.execPath, ['bin.mjs', 'mcp', demo], {
      cwd: cliDir,
      env: childEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stdin.write(request)
    const done = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve(-1)
      }, 20000)
      child.on('error', reject)
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code ?? 0)
      })
    })
    const sawTools = new Promise<void>((resolve) => {
      child.stdout.on('data', () => {
        if (stdout.includes('reconstruct')) {
          child.kill()
          resolve()
        }
      })
    })
    await Promise.race([sawTools, done])
    if (!stdout.includes('reconstruct'))
      await done
    expect(stdout).toContain('reconstruct')
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed)
        continue
      expect(() => JSON.parse(trimmed)).not.toThrow()
    }
    child.kill()
  })
})
