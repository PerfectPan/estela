import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { isListenFailure } from '../failure.ts'
import { browserPlan, withoutListenDiagnostic } from './dev.ts'

describe('browserPlan', () => {
  it('opens the browser from the CLI when no session is launched, unless --no-open', () => {
    expect(browserPlan({ open: undefined, auth: true }, false)).toEqual({
      devframeOpens: false,
      cliOpens: true,
      auth: undefined,
    })
    expect(browserPlan({ open: true, auth: true }, false)).toEqual({
      devframeOpens: false,
      cliOpens: true,
      auth: undefined,
    })
    expect(browserPlan({ open: false, auth: true }, false)).toEqual({
      devframeOpens: false,
      cliOpens: false,
      auth: undefined,
    })
  })

  it('opens a launched session from the CLI alone, unless --no-open', () => {
    expect(browserPlan({ open: undefined, auth: true }, true)).toEqual({
      devframeOpens: false,
      cliOpens: true,
      auth: undefined,
    })
    expect(browserPlan({ open: true, auth: true }, true)).toEqual({
      devframeOpens: false,
      cliOpens: true,
      auth: undefined,
    })
    expect(browserPlan({ open: false, auth: true }, true)).toEqual({
      devframeOpens: false,
      cliOpens: false,
      auth: undefined,
    })
  })

  it('turns the one-time-code gate off only for --no-auth', () => {
    expect(browserPlan({ open: undefined, auth: false }, true)).toEqual({
      devframeOpens: false,
      cliOpens: true,
      auth: false,
    })
    expect(browserPlan({ open: undefined, auth: false }, false)).toEqual({
      devframeOpens: false,
      cliOpens: true,
      auth: false,
    })
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
