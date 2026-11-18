import { expect, it } from 'vite-plus/test'
import { docsUrl, slugsFromSplat } from './docs-path.ts'

// Catches regressions where locale leaks into docs URLs or trailing slashes break page lookup.
it('parses splat params and builds language-independent /docs URLs', () => {
  expect(slugsFromSplat(undefined)).toEqual([])
  expect(slugsFromSplat('guide/concepts/')).toEqual(['guide', 'concepts'])
  expect(docsUrl([])).toBe('/docs/')
  expect(docsUrl(['guide'])).toBe('/docs/guide/')
  expect(docsUrl(['reference', 'public-interface'])).toBe('/docs/reference/public-interface/')
})
