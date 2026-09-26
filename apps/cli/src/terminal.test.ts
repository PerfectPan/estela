import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { installPlainFilter, sayReady } from './terminal.ts'

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
  }) as typeof stdout.write
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

describe('installPlainFilter', () => {
  it('passes buffer chunks through unless they contain ESC', () => {
    const seen: unknown[][] = []
    stdout.isTTY = false
    stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      seen.push([chunk, ...rest])
      return true
    }) as typeof stdout.write
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
