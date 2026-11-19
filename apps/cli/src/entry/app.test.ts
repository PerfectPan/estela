import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import pkg from '../../package.json' with { type: 'json' }
import { runCli } from './app.ts'

const stdinTTY = process.stdin.isTTY

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.stdin.isTTY = stdinTTY
})

function capture(): { stdout: () => string; stderr: () => string } {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    err.push(String(chunk))
    return true
  })
  return { stdout: () => out.join(''), stderr: () => err.join('') }
}

const FIX = 'Run estela --help for usage.\n'

/** A missing session in this system's absolute form, so its label reads the same before and after `resolve`. */
const missing = (name: string): string => resolve('/nonexistent', name)

describe('runCli', () => {
  it('prints the package version', async () => {
    const io = capture()
    expect(await runCli(['--version'])).toBe(0)
    expect(io.stdout()).toBe(`estela ${pkg.version}\n`)
  })

  it('fails an unknown option before the session is read, with the cause and one fix line', async () => {
    const io = capture()
    expect(await runCli(['--bogus', '/nonexistent/session.jsonl'])).toBe(1)
    expect(io.stderr()).toBe(`unexpected: \`--bogus\`\n${FIX}`)
    expect(io.stdout()).toBe('')
  })

  it('rejects a session or option written before a command', async () => {
    const io = capture()
    expect(await runCli(['--port', '1', 'build', '/nonexistent/session.jsonl'])).toBe(1)
    expect(await runCli(['--no-open', 'mcp'])).toBe(1)
    expect(await runCli(['/nonexistent/session.jsonl', 'export-atif'])).toBe(1)
    // `--no-pick` names the default, and is still a dev server option.
    expect(await runCli(['--no-pick', 'mcp', '/nonexistent/session.jsonl'])).toBe(1)
    expect(io.stderr()).toBe(
      ['build', 'mcp', 'export-atif', 'mcp']
        .map(command => `put the session and options after \`${command}\`\n${FIX}`)
        .join(''),
    )
  })

  it('rejects --pick with a session path, and without an interactive terminal', async () => {
    const io = capture()
    expect(await runCli(['--pick', '/nonexistent/session.jsonl'])).toBe(1)
    process.stdin.isTTY = false
    expect(await runCli(['--pick'])).toBe(1)
    expect(io.stderr()).toBe(
      `--pick cannot be used with a session path\n${FIX}--pick needs an interactive terminal\n${FIX}`,
    )
  })

  it('reads the one token after -- as the session and rejects a second', async () => {
    const io = capture()
    expect(await runCli(['export-atif', '--', missing('-weird.jsonl')])).toBe(1)
    expect(io.stderr()).toContain(`Could not export ${missing('-weird.jsonl')}: `)
    expect(await runCli([missing('a.jsonl'), '--', missing('b.jsonl')])).toBe(1)
    expect(io.stderr()).toContain(`unexpected: \`${missing('b.jsonl')}\`\n${FIX}`)
  })

  it('keeps stdout free on an mcp failure: it carries only the protocol', async () => {
    const io = capture()
    expect(await runCli(['mcp', missing('session.jsonl')])).toBe(1)
    expect(io.stdout()).toBe('')
    expect(io.stderr().startsWith(`Could not load ${missing('session.jsonl')}: `)).toBe(true)
    expect(io.stderr()).toMatch(/: .+\nPass a canonical Estela JSON file/)
  })

  it('reads the session from ESTELA_PATH when the command line names none', async () => {
    const fromEnv = missing('from-env.jsonl')
    vi.stubEnv('ESTELA_PATH', fromEnv)
    const out = await mkdtemp(join(tmpdir(), 'estela-path-'))
    try {
      const io = capture()
      expect(await runCli(['--no-open', '--no-index'])).toBe(1)
      expect(await runCli(['mcp'])).toBe(1)
      expect(await runCli(['build', '--out-dir', join(out, 'report')])).toBe(1)
      expect(await runCli(['export-atif', '--out', join(out, 'a.json')])).toBe(1)
      expect(await runCli(['export-otlp', '--out', join(out, 'o.json')])).toBe(1)
      for (const action of ['load', 'load', 'build', 'export', 'export']) {
        expect(io.stderr()).toContain(`Could not ${action} ${fromEnv}: `)
      }
      expect(io.stderr().split(`${fromEnv}: `)).toHaveLength(6)

      // A session on the command line wins over ESTELA_PATH.
      expect(await runCli(['export-atif', missing('given.jsonl'), '--out', join(out, 'g.json')])).toBe(1)
      expect(io.stderr()).toContain(`Could not export ${missing('given.jsonl')}: `)
      expect(io.stderr().split(`${fromEnv}: `)).toHaveLength(6)
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  })

  it('reads an empty ESTELA_PATH as no session: an export falls back to the bundled demo trace', async () => {
    vi.stubEnv('ESTELA_PATH', '')
    const out = await mkdtemp(join(tmpdir(), 'estela-path-'))
    try {
      capture()
      expect(await runCli(['export-atif', '--out', join(out, 'demo.json')])).toBe(0)
      expect(JSON.parse(await readFile(join(out, 'demo.json'), 'utf8'))).toHaveProperty('schema_version', 'ATIF-v1.8')
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  })

  it('refuses --no-auth with a non-loopback --host before starting a server', async () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.50']) {
      const io = capture()
      expect(await runCli(['--no-auth', '--host', host])).toBe(1)
      expect(io.stdout()).toBe('')
      expect(io.stderr()).toBe(`--no-auth cannot be used with a non-loopback --host\n${FIX}`)
    }
  })

  it('refuses an ESTELA_MCP_TOKEN with spaces or non-ASCII characters before starting a server', async () => {
    for (const token of ['two words', ' padded', 'tökén']) {
      vi.stubEnv('ESTELA_MCP_TOKEN', token)
      const io = capture()
      expect(await runCli(['--mcp'])).toBe(1)
      expect(io.stdout()).toBe('')
      expect(io.stderr()).toBe(`ESTELA_MCP_TOKEN must be visible ASCII characters without spaces\n${FIX}`)
    }
  })

  it('refuses --mcp with a non-loopback --host before starting a server', async () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.50']) {
      const io = capture()
      expect(await runCli(['--mcp', '--host', host])).toBe(1)
      expect(io.stdout()).toBe('')
      expect(io.stderr()).toBe(`--mcp cannot be used with a non-loopback --host\n${FIX}`)
    }
  })
})
