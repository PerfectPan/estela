import { Writable } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { installPlainFilter, sayMcpRoute, sayReady } from './terminal.ts'
import { startSessionIndex } from './index-progress.ts'

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
  const url = 'http://localhost:7392/__estela/'

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

describe('sayMcpRoute', () => {
  const url = 'http://localhost:7392/__estela/__mcp'

  it('prints the route and the header with a token made for this launch', () => {
    const chunks = capture(120)
    process.env.NO_COLOR = '1'
    sayMcpRoute(url, 'made-token')
    expect(chunks.join('')).toBe(`MCP: ${url}\nMCP header: Authorization: Bearer made-token\n`)
  })

  it('names ESTELA_MCP_TOKEN instead of echoing a token the user set', () => {
    const chunks = capture(120)
    sayMcpRoute(url, undefined)
    const visible = stripVTControlCharacters(chunks.join(''))
    expect(visible).toContain(`MCP: ${url}`)
    expect(visible).toContain('MCP header: Authorization: Bearer $ESTELA_MCP_TOKEN')
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

  it('names a root that could not be read on its agent’s line instead of counting 0/0 files', () => {
    const chunks: string[] = []
    stdout.isTTY = false
    delete process.env.NO_COLOR
    stdout.write = (chunk: string | Uint8Array) => {
      chunks.push(String(chunk))
      return true
    }
    const index = startSessionIndex()
    index.tick([
      { name: 'Claude Code', read: 0, done: false },
      { name: 'Codex', read: 0, done: false },
      { name: 'Grok', read: 1, total: 1, done: false },
    ])
    expect(chunks).toEqual([])
    index.tick([
      { name: 'Claude Code', read: 0, done: true, unreadable: '~/.claude/projects' },
      {
        name: 'Codex',
        read: 0,
        done: true,
        checked: '~/.codex/archived_sessions',
        unreadable: '~/.codex/sessions',
      },
      { name: 'Grok', read: 1, total: 1, done: true, unreadable: '~/.grok/old' },
    ])
    index.finish()
    expect(chunks.join('')).toBe(
      'Claude Code: 0 files, could not read ~/.claude/projects\n'
        + 'Codex: 0 files, checked ~/.codex/archived_sessions, could not read ~/.codex/sessions\n'
        + 'Grok: 1/1 files read, could not read ~/.grok/old\n',
    )
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
function sink(): (string | Uint8Array)[] {
  const chunks: (string | Uint8Array)[] = []
  const stream = new Writable({
    decodeStrings: false,
    write(chunk: string | Uint8Array, _encoding, done) {
      chunks.push(chunk)
      done()
    },
  })
  stdout.isTTY = false
  stdout.write = stream.write.bind(stream)
  installPlainFilter()
  return chunks
}

describe('installPlainFilter write callbacks', () => {
  const binary = Buffer.from([0x00, 0x80, 0xfe, 0xff])
  const cases: Record<string, { chunk: string | Uint8Array; expected: string | Uint8Array }> = {
    string: { chunk: '\u001b[31mred\u001b[0m', expected: 'red' },
    'rewritten buffer': { chunk: Buffer.from('\u001b[31mred\u001b[0m'), expected: 'red' },
    // No ESC and not UTF-8: the bytes go on as they are, never decoded to text.
    'binary buffer': { chunk: binary, expected: binary },
  }

  for (const [branch, { chunk, expected }] of Object.entries(cases)) {
    it(`runs the callback of a ${branch} chunk written as write(chunk, callback)`, async () => {
      const written = sink()
      const callback = vi.fn<(error?: Error | null) => void>()
      stdout.write(chunk, callback)
      await new Promise(resolve => setImmediate(resolve))
      expect(callback).toHaveBeenCalledOnce()
      expect(written).toEqual([expected])
    })

    for (const encoding of [null, undefined, 'utf8']) {
      it(`runs the callback of a ${branch} chunk written with a ${String(encoding)} encoding`, async () => {
        const written = sink()
        const callback = vi.fn<(error?: Error | null) => void>()
        // Node accepts a null encoding, which the typed overloads leave out.
        Reflect.apply(stdout.write.bind(stdout), undefined, [chunk, encoding, callback])
        await new Promise(resolve => setImmediate(resolve))
        expect(callback).toHaveBeenCalledOnce()
        expect(written).toEqual([expected])
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

  it('strips non-SGR escapes, C0/C1 controls, and bidi characters from [devframe] and auth banner TTY output while keeping SGR colors', () => {
    const seen: string[] = []
    stdout.isTTY = true
    stdout.write = (chunk: string) => {
      seen.push(chunk)
      return true
    }
    installPlainFilter({ homeDir: home })
    stdout.write(
      `\u001b[36m[devframe]\u001b[39m \u001b]8;;https://evil\u0007click\u001b]8;;\u0007 \u001b[2K\u001bPbad\u001b\\\u001b_apc\u001b\\\u009b31m\u202E${home}/x\r\n`,
    )
    expect(seen[0]).toBe('\u001b[36m[devframe]\u001b[39m click ~/x\n')

    const banner = Buffer.from(
      '\n\u001b[33mauth code\u001b[0m  123456\nua  \u001b]52;c;bad\u0007\u001b^pm\u001b\\\u001bXsos\u001b\\\u202Eevil\r\nexpires at 10:00\n',
    )
    stdout.write(banner)
    expect(seen[1]).toBe('\n\u001b[33mauth code\u001b[0m  123456\nua  evil\nexpires at 10:00\n')
  })
})
