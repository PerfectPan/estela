import { describe, expect, it } from 'vite-plus/test'
import { i18nSearchData } from './search-export.ts'

// Catches mismatched search export shapes when Fumadocs changes export() return shape.
describe('i18nSearchData', () => {
  it('returns the per-locale map for i18n search exports', () => {
    const data = { en: { type: 'advanced' }, 'zh-CN': { type: 'advanced' } }
    expect(i18nSearchData({ type: 'i18n', data })).toBe(data)
  })

  it('throws a diagnostic error for non-i18n exports', () => {
    expect(() => i18nSearchData({ type: 'advanced' })).toThrow('expected per-language search export, got advanced')
  })
})
