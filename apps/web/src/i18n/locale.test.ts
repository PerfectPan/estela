// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { applyLocale, locale } from './locale.ts'

afterEach(() => {
  applyLocale('en')
})

describe('applyLocale', () => {
  it('writes lang to documentElement by default', () => {
    applyLocale('zh-CN')
    expect(locale()).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
  })

  it('writes lang to an explicit host element without changing documentElement', () => {
    applyLocale('en')
    const host = document.createElement('div')
    applyLocale('zh-CN', host)
    expect(locale()).toBe('zh-CN')
    expect(host.lang).toBe('zh-CN')
    expect(document.documentElement.lang).toBe('en')
  })
})
