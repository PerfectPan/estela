import { describe, expect, it } from 'vite-plus/test'
import { browserPlan } from './dev.ts'

describe('browserPlan', () => {
  it('lets DevFrame open the session browser when no session is launched, unless --no-open', () => {
    expect(browserPlan({ open: undefined, auth: true }, false)).toEqual({
      devframeOpens: true,
      cliOpens: false,
      auth: undefined,
    })
    expect(browserPlan({ open: true, auth: true }, false)).toEqual({
      devframeOpens: true,
      cliOpens: false,
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
      devframeOpens: true,
      cliOpens: false,
      auth: false,
    })
  })
})
