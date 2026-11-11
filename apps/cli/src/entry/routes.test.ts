import { parse, printErrors } from '@bomb.sh/router'
import { describe, expect, it } from 'vite-plus/test'
import { helpText } from './help.ts'
import { cliRoutes } from './routes.ts'

const routes = cliRoutes('1.2.3')

function route(...argv: string[]) {
  return parse(routes, { argv })
}

/** The execute intent of `argv`; anything else fails the test with what the router returned. */
function execute(...argv: string[]) {
  const result = route(...argv)
  if (!result.ok || result.method !== 'execute') {
    throw new Error(`no execute intent for ${JSON.stringify(argv)}: ${result.ok ? result.method : printErrors(result)}`)
  }
  return result
}

/** The router's message for `argv`, which must be rejected. */
function rejection(...argv: string[]): string {
  const result = route(...argv)
  if (result.ok) {
    throw new Error(`${JSON.stringify(argv)} was accepted as ${result.method} ${result.route}`)
  }
  return printErrors(result)
}

describe('cli routes', () => {
  it('takes a session path on the dev server', () => {
    const intent = execute('/tmp/session.json')
    expect(intent.route).toBe('/')
    expect(intent.model.session).toBe('/tmp/session.json')
  })

  it('takes build <path> --out-dir x, and --out-dir=x', () => {
    expect(execute('build', '/tmp/session.json', '--out-dir', 'x')).toMatchObject({
      route: '/build',
      model: { session: '/tmp/session.json', outDir: 'x' },
    })
    expect(execute('build', '--out-dir=x').model).toMatchObject({ outDir: 'x' })
  })

  it('takes export-atif <path> --out x and export-otlp --out=y <path>', () => {
    expect(execute('export-atif', '/tmp/session.jsonl', '--out', 'x.json')).toMatchObject({
      route: '/export-atif',
      model: { session: '/tmp/session.jsonl', out: 'x.json' },
    })
    expect(execute('export-otlp', '--out=y.json', '/tmp/session.jsonl')).toMatchObject({
      route: '/export-otlp',
      model: { session: '/tmp/session.jsonl', out: 'y.json' },
    })
  })

  it('reads --port as a number before the path, and takes mcp <path>', () => {
    expect(execute('--port', '7392', '/tmp/session.json').model).toMatchObject({
      port: 7392,
      session: '/tmp/session.json',
    })
    expect(execute('--port', '0').model).toMatchObject({ port: 0 })
    expect(execute('mcp', '/tmp/session.json')).toMatchObject({
      route: '/mcp',
      model: { session: '/tmp/session.json' },
    })
  })

  it('keeps a session path that looks like a number as text', () => {
    expect(execute('export-atif', '2026-11-10-session.jsonl').model.session).toBe('2026-11-10-session.jsonl')
    expect(execute('123').model.session).toBe('123')
  })

  it('leaves the tokens after -- to the caller as literals', () => {
    const intent = execute('--', '--weird.json')
    expect(intent.model.session).toBeUndefined()
    expect(Array.from(intent.literals, literal => literal.text)).toEqual(['--weird.json'])
  })

  it('leaves the dev server toggles absent unless given', () => {
    expect(execute().model).toMatchObject({
      open: undefined,
      auth: undefined,
      mcp: undefined,
      index: undefined,
      pick: false,
    })
    expect(execute('--pick', '--no-index', '--no-open', '--no-auth', '--mcp').model).toMatchObject({
      pick: true,
      index: false,
      open: false,
      auth: false,
      mcp: true,
    })
  })

  it('rejects a second session path', () => {
    expect(rejection('/tmp/a.json', '/tmp/b.json')).toBe('unexpected: `/tmp/b.json`')
  })

  it('rejects an option without its value', () => {
    expect(rejection('build', 'x', '--out-dir')).toBe('--out-dir requires a value')
    expect(rejection('--port', '--no-open')).toBe('--port requires a value')
    expect(rejection('build', '--out-dir=')).toBe('outDir: expected a value')
  })

  it('refuses - as a file to write instead of creating a file named -', () => {
    expect(rejection('export-otlp', '--out', '-')).toBe('out: expected a path; writing to stdout (-) is not supported')
    expect(rejection('build', '--out-dir=-')).toBe('outDir: expected a path; writing to stdout (-) is not supported')
  })

  it('rejects options the route does not take', () => {
    expect(rejection('--bogus')).toBe('unexpected: `--bogus`')
    expect(rejection('build', '--pretty')).toBe('unexpected: `--pretty`')
    expect(rejection('mcp', '--pick')).toBe('unexpected: `--pick`')
    expect(rejection('export-atif', '--out-dir', 'x')).toContain('unexpected: `--out-dir`')
  })

  it('rejects a port outside 0-65535', () => {
    expect(rejection('--port', '70000')).toBe('port: expected a port number from 0 to 65535')
    expect(rejection('--port', 'abc')).toBe('port: expected a port number from 0 to 65535')
  })

  it('answers --help and --version on every route', () => {
    for (const command of [[], ['build'], ['mcp'], ['export-atif'], ['export-otlp']]) {
      const path = `/${command.join('/')}`
      expect(route(...command, '--help')).toMatchObject({ ok: true, method: 'help', route: path })
      expect(route(...command, '-h', '--port')).toMatchObject({ ok: true, method: 'help', route: path })
      expect(route(...command, '-v')).toMatchObject({ ok: true, method: 'version', route: path })
    }
  })
})

describe('helpText', () => {
  function help(...argv: string[]): string {
    const result = route(...argv, '--help')
    if (!result.ok || result.method !== 'help') {
      throw new Error(`no help intent for ${JSON.stringify(argv)}`)
    }
    return helpText(result)
  }

  it('lists every command and the dev server options', () => {
    const text = help()
    expect(text.split('\n')[0]).toBe('agent-trace 1.2.3')
    // The session goes before options or after a command name, never before one.
    expect(text).toContain('Usage:\n  agent-trace [OPTIONS] [SESSION]\n  agent-trace <COMMAND> [OPTIONS] [SESSION]\n')
    expect(text).not.toContain('<SESSION>')
    for (const name of ['build', 'mcp', 'export-atif', 'export-otlp', '--pick', '--no-index', '--port <VALUE>']) {
      expect(text).toContain(name)
    }
  })

  it('names a command with the program in front of it', () => {
    const text = help('build')
    expect(text.split('\n')[0]).toBe('agent-trace build 1.2.3')
    expect(text).toContain('Usage:\n  agent-trace build [OPTIONS] [SESSION]\n')
    expect(text).toContain('[SESSION]  A session file, path#sessionId, or canonical agent-trace JSON')
    expect(text).toContain('--out-dir <VALUE>')
    expect(text).not.toContain('--pick')
  })
})
