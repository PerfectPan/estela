// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { chooseTheme, initTheme } from './theme.ts'

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.kbTheme
  initTheme()
})

describe('theme', () => {
  it('writes data-theme without setting data-kb-theme', () => {
    initTheme()
    chooseTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.kbTheme).toBeUndefined()
  })
})
