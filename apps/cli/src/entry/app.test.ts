import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import pkg from '../../package.json' with { type: 'json' }
import { runCli } from './app.ts'

const stdinTTY = process.stdin.isTTY

afterEach(() => {
  vi.restoreAllMocks()
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

const FIX = 'Run agent-trace --help for usage.\n'

describe('runCli', () => {
  it('prints the package version', async () => {
    const io = capture()
    expect(await runCli(['--version'])).toBe(0)
    expect(io.stdout()).toBe(`agent-trace ${pkg.version}\n`)
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
    expect(io.stderr()).toBe(
      ['build', 'mcp', 'export-atif']
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
    expect(await runCli(['export-atif', '--', '/nonexistent/-weird.jsonl'])).toBe(1)
    expect(io.stderr()).toContain('Could not export /nonexistent/-weird.jsonl: ')
    expect(await runCli(['/nonexistent/a.jsonl', '--', '/nonexistent/b.jsonl'])).toBe(1)
    expect(io.stderr()).toContain(`unexpected: \`/nonexistent/b.jsonl\`\n${FIX}`)
  })

  it('keeps stdout free on an mcp failure: it carries only the protocol', async () => {
    const io = capture()
    expect(await runCli(['mcp', '/nonexistent/session.jsonl'])).toBe(1)
    expect(io.stdout()).toBe('')
    expect(io.stderr()).toMatch(
      /^Could not load \/nonexistent\/session\.jsonl: .+\nPass a canonical agent-trace JSON file/,
    )
  })
})
