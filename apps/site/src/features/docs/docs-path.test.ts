import { expect, it } from 'vite-plus/test'
import {
  DEFAULT_DOCS_SPLAT,
  docsSplatFromPathname,
  docsUrl,
  isDocsPath,
  slugsFromSplat,
  stripIndexHtmlSuffix,
} from './docs-path.ts'

// Catches regressions where locale leaks into docs URLs, trailing slashes break lookup, or index.html URLs fail.
it('parses splat params and builds language-independent /docs URLs', () => {
  expect(slugsFromSplat(undefined)).toEqual([])
  expect(slugsFromSplat('guide/concepts/')).toEqual(['guide', 'concepts'])
  expect(docsUrl([])).toBe('/docs/')
  expect(docsUrl(['guide'])).toBe('/docs/guide/')
  expect(docsUrl(['reference', 'public-interface'])).toBe('/docs/reference/public-interface/')
})

it('detects docs paths, extracts default splat, and strips explicit index.html suffixes', () => {
  expect(isDocsPath('/estela/docs', '/estela/')).toBe(true)
  expect(isDocsPath('/estela/docs/guide/privacy/', '/estela/')).toBe(true)
  expect(isDocsPath('/estela/', '/estela/')).toBe(false)
  expect(isDocsPath('/estela/demo/', '/estela/')).toBe(false)

  expect(docsSplatFromPathname('/estela/docs/', '/estela/')).toBe(DEFAULT_DOCS_SPLAT)
  expect(docsSplatFromPathname('/estela/docs/guide/privac%79/', '/estela/')).toBe('guide/privacy')

  expect(stripIndexHtmlSuffix('/estela/docs/guide/privacy/index.html')).toBe('/estela/docs/guide/privacy/')
  expect(stripIndexHtmlSuffix('/estela/index.html')).toBe('/estela/')
  expect(stripIndexHtmlSuffix('/estela/docs/guide/privacy/')).toBeNull()
})
