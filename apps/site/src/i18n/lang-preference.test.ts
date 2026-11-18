import { describe, expect, it } from 'vite-plus/test'
import { languageFrom } from './lang-preference.ts'

// Catches regressions in stored-preference priority and navigator.language fallback.
describe('languageFrom', () => {
  it('prefers valid stored choices over navigator.language', () => {
    expect(languageFrom('en', 'zh-CN')).toBe('en')
    expect(languageFrom('zh-CN', 'en-US')).toBe('zh-CN')
  })

  it('falls back to zh-CN for any zh navigator language and en otherwise', () => {
    expect(languageFrom(null, 'zh-CN')).toBe('zh-CN')
    expect(languageFrom(null, 'zh-TW')).toBe('zh-CN')
    expect(languageFrom('invalid', 'zh')).toBe('zh-CN')
    expect(languageFrom(null, 'en-US')).toBe('en')
    expect(languageFrom(null, '')).toBe('en')
  })
})
