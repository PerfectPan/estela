import { stripVTControlCharacters } from 'node:util'
import { createAuthBanner } from 'devframe/recipes/interactive-auth'
import { homeDir } from '@rivus/estela-runtime-node'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { CliError, failureReport, isListenFailure } from '../failure.ts'
import {
  browserPlan,
  discoveredForPick,
  resolveAuthBannerUrl,
  sanitizeAuthBannerInfo,
  withoutListenDiagnostic,
} from './dev.ts'

describe('discoveredForPick', () => {
  it('ends a discover pass that failed behind the index rows as an index failure, with no home directory', async () => {
    // As when a folder loses its search permission while the pass reads it: the stat made for a session's cache key fails.
    const cause = Object.assign(
      new Error(`EACCES: permission denied, stat '${homeDir()}/.claude/projects/app/session.jsonl'`),
      { code: 'EACCES' },
    )
    const thrown: unknown = await discoveredForPick({
      discovered: async () => {
        throw cause
      },
    }).catch(error => error)
    if (!(thrown instanceof CliError)) {
      throw new TypeError(`a CliError was expected, got ${String(thrown)}`)
    }
    // Not the raw error `catalog.discovered()` rejected with: that one prints its stack.
    expect(thrown).not.toBe(cause)
    const report = failureReport(thrown.failure)
    expect(report).toEqual({
      message: {
        cause: "Could not index sessions: EACCES: permission denied, stat '~/.claude/projects/app/session.jsonl'",
        fix: 'Check the agent session directories, or pass --no-index.',
      },
      exitCode: 1,
    })
    expect(JSON.stringify(report)).not.toContain(homeDir())
  })

  it('returns once the pass is done', async () => {
    await expect(discoveredForPick({ discovered: async () => {} })).resolves.toBeUndefined()
  })
})

describe('browserPlan', () => {
  it('opens the browser from the CLI unless --no-open and passes --no-auth through', () => {
    expect(browserPlan({ open: undefined, auth: true })).toEqual({
      cliOpens: true,
      auth: undefined,
    })
    expect(browserPlan({ open: true, auth: true })).toEqual({
      cliOpens: true,
      auth: undefined,
    })
    expect(browserPlan({ open: false, auth: true })).toEqual({
      cliOpens: false,
      auth: undefined,
    })
    expect(browserPlan({ open: undefined, auth: false })).toEqual({
      cliOpens: true,
      auth: false,
    })
  })
})

describe('resolveAuthBannerUrl', () => {
  it('preserves explicit loopback hosts and maps wildcards to their loopback address under /__estela/', () => {
    expect(resolveAuthBannerUrl('http://localhost:7392', '127.0.0.1')).toBe('http://127.0.0.1:7392/__estela/')
    expect(resolveAuthBannerUrl('http://localhost:7392', '[::1]')).toBe('http://[::1]:7392/__estela/')
    expect(resolveAuthBannerUrl('http://localhost:7392', 'localhost')).toBe('http://localhost:7392/__estela/')
    expect(resolveAuthBannerUrl('http://localhost:7392', '0.0.0.0')).toBe('http://127.0.0.1:7392/__estela/')
    expect(resolveAuthBannerUrl('http://localhost:7392', '::')).toBe('http://[::1]:7392/__estela/')
  })
})

describe('sanitizeAuthBannerInfo', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('strips newlines, ANSI SGR/OSC escapes, and bidi controls from requester fields before printing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const render = createAuthBanner()
    render(
      sanitizeAuthBannerInfo({
        code: '123456',
        url: 'http://127.0.0.1:7392/__estela/#devframe_otp=123456',
        expireAt: Date.now() + 60_000,
        requester: {
          ua: 'Chrome 120\n│ auth code  000000\x1b[31m\x1b]0;pwn\x07',
          origin: 'http://evil\u202E.example\r\nforged: line',
        },
      }),
    )

    expect(spy).toHaveBeenCalledTimes(1)
    const rendered = String(spy.mock.calls[0]?.[0] ?? '')
    expect(rendered).toContain('http://127.0.0.1:7392/__estela/#devframe_otp=123456')
    expect(rendered).not.toContain('\x1b[31m')
    expect(rendered).not.toContain('\x1b]0;')
    expect(rendered).not.toContain('\u202E')
    const plain = stripVTControlCharacters(rendered)
    const authCodeLines = plain.split('\n').filter(line => line.trimStart().startsWith('│ auth code'))
    expect(authCodeLines).toHaveLength(1)
    expect(plain.split('\n').some(line => line.includes('ua') && line.includes('000000'))).toBe(true)
    expect(plain.split('\n').some(line => line.includes('origin') && line.includes('forged: line'))).toBe(true)
    expect(plain.split('\n').some(line => line.trimStart().startsWith('forged: line'))).toBe(false)
  })
})

describe('withoutListenDiagnostic', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('drops DF0052 warnings when a listen error is thrown while keeping other warnings', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      withoutListenDiagnostic(async () => {
        console.warn('\x1b[31m[DF0052]\x1b[39m Failed to listen on 127.0.0.1:9999')
        console.warn('unrelated startup notice')
        throw { code: 'DF0052' }
      }, isListenFailure),
    ).rejects.toEqual({ code: 'DF0052' })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('unrelated startup notice')
  })

  it('flushes held DF0052 warnings if another failure happens instead', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(
      withoutListenDiagnostic(async () => {
        console.warn('[DF0052] unexpected warning')
        throw new Error('other failure')
      }, isListenFailure),
    ).rejects.toThrow('other failure')

    expect(spy).toHaveBeenCalledWith('[DF0052] unexpected warning')
  })
})
