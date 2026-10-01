import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { installPlainFilter, sayReady } from './terminal.ts'
import { startSessionIndex } from './terminal-index.ts'

const stdout = process.stdout as NodeJS.WriteStream & { columns: number | undefined }
const stderr = process.stderr
const original = {
  isTTY: stdout.isTTY,
  columns: stdout.columns,
  write: stdout.write.bind(stdout),
  stderrWrite: stderr.write.bind(stderr),
  term: process.env.TERM,
}

afterEach(() => {
  stdout.isTTY = original.isTTY
  stdout.columns = original.columns
  stdout.write = original.write
  stderr.write = original.stderrWrite
  if (original.term === undefined)
    delete process.env.TERM
  else
    process.env.TERM = original.term
  delete process.env.NO_COLOR
})

function capture(columns: number): string[] {
  const chunks: string[] = []
  stdout.isTTY = true
  stdout.columns = columns
  delete process.env.NO_COLOR
  stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  })
  return chunks
}

describe('sayReady', () => {
  const url = 'http://localhost:7392/__agent-trace/'

  it('does not throw when stdout has 0 columns', () => {
    const chunks = capture(0)
    expect(() => sayReady(url)).not.toThrow()
    expect(chunks.join('')).toContain(`Ready: ${url}`)
  })

  it('does not throw when stdout has 8 columns', () => {
    const chunks = capture(8)
    expect(() => sayReady(url)).not.toThrow()
    expect(chunks.join('')).toContain(`Ready: ${url}`)
    expect(stripVTControlCharacters(chunks.join(''))).toContain('Ready')
  })

  it('keeps every box line the same visible length and puts OSC 8 outside the box', () => {
    process.env.TERM = 'xterm-256color'
    const chunks = capture(120)
    sayReady(url)
    const raw = chunks.join('')
    expect(raw).toContain(`\u001b]8;;${url}`)
    const visible = stripVTControlCharacters(raw).split('\n')
    const start = visible.findIndex(line => line.includes('┌'))
    const end = visible.findIndex((line, index) => index > start && line.includes('└') && line.includes('─'))
    const boxLines = visible.slice(start, end + 1)
    expect(boxLines.length).toBeGreaterThan(1)
    expect(new Set(boxLines.map(line => line.length)).size).toBe(1)
    const boxed = raw.split('\n').filter(line => line.includes('┌') || line.includes('└') || (line.includes('│') && line.includes(url)))
    expect(boxed.some(line => line.includes('\u001b]8;;'))).toBe(false)
  })
})

describe('startSessionIndex', () => {
  it('prints one line per host when it is done, when stdout is not a TTY', () => {
    const chunks: string[] = []
    stdout.isTTY = false
    delete process.env.NO_COLOR
    stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    })
    const index = startSessionIndex()
    index.tick([
      { name: 'Claude Code', read: 1, done: false },
      { name: 'Codex', read: 0, done: false },
    ])
    expect(chunks).toEqual([])
    index.tick([
      { name: 'Claude Code', read: 2, done: true },
      { name: 'Codex', read: 0, done: true, checked: '~/.codex/sessions' },
    ])
    index.finish()
    expect(chunks.join('')).toBe('Claude Code: 2/2 files read\nCodex: 0 files, checked ~/.codex/sessions\n')
  })
})

describe('installPlainFilter', () => {
  it('passes buffer chunks through unless they contain ESC', () => {
    const seen: unknown[][] = []
    stdout.isTTY = false
    stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      seen.push([chunk, ...rest])
      return true
    })
    installPlainFilter()
    const plain = Buffer.from('hello')
    stdout.write(plain, () => {})
    expect(seen[0]?.[0]).toBe(plain)
    expect(typeof seen[0]?.[1]).toBe('function')
    const ansi = Buffer.from('\u001b[31mred\u001b[0m')
    stdout.write(ansi, 'utf8')
    expect(seen[1]?.[0]).toBe('red')
    expect(seen[1]?.length).toBe(1)
  })
})

describe('DevFrame log lines', () => {
  const users = '/Users'
  const home = `${users}/alice`
  const line = `\u001b[36m[devframe] copying SPA from ${home}/app/web/dist -> /tmp/out\u001b[39m\n`

  it('replaces the home directory with ~ on a TTY and keeps colors', () => {
    const seen: string[] = []
    stdout.isTTY = true
    stdout.write = ((chunk: string) => {
      seen.push(chunk)
      return true
    })
    installPlainFilter({ homeDir: home })
    stdout.write(line)
    stdout.write(`other ${home}\n`)
    expect(seen[0]).toBe('\u001b[36m[devframe] copying SPA from ~/app/web/dist -> /tmp/out\u001b[39m\n')
    expect(seen[1]).toBe(`other ${home}\n`)
  })

  it('replaces the home directory with ~ in plain output', () => {
    const seen: string[] = []
    stdout.isTTY = false
    stdout.write = ((chunk: string) => {
      seen.push(chunk)
      return true
    })
    installPlainFilter({ homeDir: home })
    stdout.write(Buffer.from(line))
    expect(seen[0]).toBe('[devframe] copying SPA from ~/app/web/dist -> /tmp/out\n')
  })
})
