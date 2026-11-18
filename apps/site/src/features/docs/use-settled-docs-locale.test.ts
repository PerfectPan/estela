import { describe, expect, it } from 'vite-plus/test'
import { reconcileSettledState, resolveActiveLocale } from './use-settled-docs-locale.ts'

describe('resolveActiveLocale', () => {
  it('holds the settled locale on same-route language switches until the target chunk is loaded', () => {
    expect(
      resolveActiveLocale({
        settled: { splatKey: 'guide/privacy', lang: 'en' },
        splatKey: 'guide/privacy',
        lang: 'zh-CN',
        targetLoaded: false,
      }),
    ).toBe('en')
  })

  it('switches immediately when the target chunk is already loaded (preloaded or cached)', () => {
    expect(
      resolveActiveLocale({
        settled: { splatKey: 'guide/privacy', lang: 'en' },
        splatKey: 'guide/privacy',
        lang: 'zh-CN',
        targetLoaded: true,
      }),
    ).toBe('zh-CN')
  })

  it('uses the requested locale immediately on cross-page navigation so old-page state does not pin the new route', () => {
    expect(
      resolveActiveLocale({
        settled: { splatKey: 'guide/privacy', lang: 'en' },
        splatKey: 'guide/concepts',
        lang: 'zh-CN',
        targetLoaded: false,
      }),
    ).toBe('zh-CN')
  })

  it('returns the requested locale once settled matches it even before checking cache state', () => {
    expect(
      resolveActiveLocale({
        settled: { splatKey: 'guide/privacy', lang: 'zh-CN' },
        splatKey: 'guide/privacy',
        lang: 'zh-CN',
        targetLoaded: false,
      }),
    ).toBe('zh-CN')
  })
})

describe('reconcileSettledState', () => {
  it('preserves reference identity when route and locale are unchanged', () => {
    const current = { splatKey: 'guide/privacy', lang: 'zh-CN' as const }
    expect(reconcileSettledState(current, { splatKey: 'guide/privacy', lang: 'zh-CN' })).toBe(current)
  })

  it('returns the new state when either splatKey or lang advances', () => {
    const current = { splatKey: 'guide/privacy', lang: 'en' as const }
    const nextLocale = { splatKey: 'guide/privacy', lang: 'zh-CN' as const }
    const nextRoute = { splatKey: 'guide/concepts', lang: 'en' as const }
    expect(reconcileSettledState(current, nextLocale)).toBe(nextLocale)
    expect(reconcileSettledState(current, nextRoute)).toBe(nextRoute)
  })
})
