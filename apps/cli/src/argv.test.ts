import { describe, expect, it } from 'vitest'
import { parseCommand } from './argv.ts'

function parse(...args: string[]) {
  return parseCommand(['node', 'bin.mjs', ...args])
}

describe('parseCommand', () => {
  it('takes a positional path on the default command', () => {
    const parsed = parse('/tmp/session.json')
    expect(parsed.command).toBe('dev')
    expect(parsed.path).toBe('/tmp/session.json')
    expect(parsed.error).toBeUndefined()
  })

  it('takes build <path> --out-dir x', () => {
    const parsed = parse('build', '/tmp/session.json', '--out-dir', 'x')
    expect(parsed.command).toBe('build')
    expect(parsed.path).toBe('/tmp/session.json')
    expect(parsed.outDir).toBe('x')
    expect(parsed.userArgs).toContain('--out-dir')
  })

  it('reads --out-dir=x', () => {
    expect(parse('build', '--out-dir=x').outDir).toBe('x')
  })

  it('keeps --port before the path', () => {
    const parsed = parse('--port', '7392', '/tmp/session.json')
    expect(parsed.path).toBe('/tmp/session.json')
    expect(parsed.userArgs).toEqual(['--port', '7392'])
  })

  it('takes mcp <path>', () => {
    const parsed = parse('mcp', '/tmp/session.json')
    expect(parsed.command).toBe('mcp')
    expect(parsed.path).toBe('/tmp/session.json')
  })

  it('treats tokens after -- as positional', () => {
    const parsed = parse('--', '--weird.json')
    expect(parsed.path).toBe('--weird.json')
    expect(parsed.error).toBeUndefined()
  })

  it('names both paths when a second positional is given', () => {
    const parsed = parse('/tmp/a.json', '/tmp/b.json')
    expect(parsed.error).toContain('/tmp/a.json')
    expect(parsed.error).toContain('/tmp/b.json')
  })

  it('records --pick and --pretty', () => {
    expect(parse('--pick').pick).toBe(true)
    expect(parse('build', '--pretty').pretty).toBe(true)
  })
})
