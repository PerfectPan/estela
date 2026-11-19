import { expect, it } from 'vite-plus/test'
import { englishFallback } from './docs-fallback.ts'

// Catches regressions where untranslated pages omit the fallback notice or translated pages show it.
it('reports English fallback only when viewing a non-zh-CN file in Chinese', () => {
  expect(englishFallback('zh-CN', 'design/README.md')).toBe(true)
  expect(englishFallback('zh-CN', 'guide/concepts.zh-CN.md')).toBe(false)
  expect(englishFallback('en', 'design/README.md')).toBe(false)
})
