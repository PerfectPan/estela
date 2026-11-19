import { expect, it } from 'vite-plus/test'
import { normalizeBasePath } from './site.ts'

// Catches duplicate slashes when joining basepath with route paths or falling back to domain root.
it.each([
  ['/estela', '/estela'],
  ['/estela/', '/estela'],
  ['/estela///', '/estela'],
  ['/', ''],
  ['', ''],
])('normalizes the URL prefix %s without trailing slashes', (input, expected) => {
  expect(normalizeBasePath(input)).toBe(expected)
  expect(`${normalizeBasePath(input)}/docs`).toBe(`${expected}/docs`)
})
