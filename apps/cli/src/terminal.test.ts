import { Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
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
  if (original.term === undefined) {
    delete process.env.TERM
  } else {
    process.env.TERM = original.term
  }
  delete process.env.NO_COLOR
})

function capture(columns: number): string[] {
  const chunks: string[] = []
  stdout.isTTY = true
  stdout.columns = columns
  delete process.env.NO_COLOR
  stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(String(chunk))
    return true
  }
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

  it('puts the one URL inside the box as an OSC 8 link, every box line the same visible width', () => {
    process.env.TERM = 'xterm-256color'
    const chunks = capture(120)
    sayReady(url)
    const raw = chunks.join('')
    expect(raw.split(`\u001b]8;;${url}\u001b\\`)).toHaveLength(2)
    const visible = stripVTControlCharacters(raw).split('\n')
    const start = visible.findIndex(line => line.includes('┌'))
    const end = visible.findIndex((line, index) => index > start && line.includes('└') && line.includes('─'))
    const boxLines = visible.slice(start, end + 1)
    expect(boxLines).toHaveLength(3)
    expect(new Set(boxLines.map(line => line.length)).size).toBe(1)
    expect(boxLines[1]).toContain(url)
    expect(visible.join('\n').split(url)).toHaveLength(2)
  })

  it('keeps the plain URL in the box when the terminal has no OSC 8', () => {
    process.env.TERM = 'dumb'
    const chunks = capture(120)
    sayReady(url)
    const raw = chunks.join('')
    expect(raw).not.toContain('\u001b]8;;')
    expect(stripVTControlCharacters(raw).split(url)).toHaveLength(2)
  })
})

describe('startSessionIndex', () => {
  it('prints one line per agent when it is done, when stdout is not a TTY', () => {
    const chunks: string[] = []
    stdout.isTTY = false
    delete process.env.NO_COLOR
    stdout.write = (chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }
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
    stdout.write = (chunk: unknown, ...rest: unknown[]) => {
      seen.push([chunk, ...rest])
      return true
    }
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

/** A real `Writable` behind stdout, so its own argument handling decides whether the callback runs. */
function sink(): string[] {
  const chunks: string[] = []
  const stream = new Writable({
    decodeStrings: false,
    write(chunk: string | Uint8Array, _encoding, done) {
      chunks.push(String(chunk))
      done()
    },
  })
  stdout.isTTY = false
  stdout.write = stream.write.bind(stream)
  installPlainFilter()
  return chunks
}

describe('installPlainFilter write callbacks', () => {
  const chunks = {
    string: '\u001b[31mred\u001b[0m',
    'rewritten buffer': Buffer.from('\u001b[31mred\u001b[0m'),
  }

  for (const [branch, chunk] of Object.entries(chunks)) {
    for (const encoding of [null, undefined, 'utf8']) {
      it(`runs the callback of a ${branch} chunk written with a ${String(encoding)} encoding`, async () => {
        const written = sink()
        const callback = vi.fn<(error?: Error | null) => void>()
        // Node accepts a null encoding, which the typed overloads leave out.
        Reflect.apply(stdout.write.bind(stdout), undefined, [chunk, encoding, callback])
        await new Promise(resolve => setImmediate(resolve))
        expect(callback).toHaveBeenCalledOnce()
        expect(written).toEqual(['red'])
      })
    }
  }
})

describe('DevFrame log lines', () => {
  const users = '/Users'
  const home = `${users}/alice`
  const line = `\u001b[36m[devframe] copying SPA from ${home}/app/web/dist -> /tmp/out\u001b[39m\n`

  it('replaces the home directory with ~ on a TTY and keeps colors', () => {
    const seen: string[] = []
    stdout.isTTY = true
    stdout.write = (chunk: string) => {
      seen.push(chunk)
      return true
    }
    installPlainFilter({ homeDir: home })
    stdout.write(line)
    stdout.write(`other ${home}\n`)
    expect(seen[0]).toBe('\u001b[36m[devframe] copying SPA from ~/app/web/dist -> /tmp/out\u001b[39m\n')
    expect(seen[1]).toBe(`other ${home}\n`)
  })

  it('replaces the home directory with ~ in plain output', () => {
    const seen: string[] = []
    stdout.isTTY = false
    stdout.write = (chunk: string) => {
      seen.push(chunk)
      return true
    }
    installPlainFilter({ homeDir: home })
    stdout.write(Buffer.from(line))
    expect(seen[0]).toBe('[devframe] copying SPA from ~/app/web/dist -> /tmp/out\n')
  })
})
