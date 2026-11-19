import { expect, it } from 'vite-plus/test'
import { readmeSlugs } from './readme-slugs.ts'

// Catches regressions where README.md renders at /docs/guide/README instead of /docs/guide.
it('drops trailing README segment for folder index pages and keeps regular slugs', () => {
  expect(readmeSlugs({}, () => ['guide', 'README'])).toEqual(['guide'])
  expect(readmeSlugs({}, () => ['design', 'README'])).toEqual(['design'])
  expect(readmeSlugs({}, () => ['guide', 'concepts'])).toEqual(['guide', 'concepts'])
  expect(readmeSlugs({}, () => ['reference', 'public-interface'])).toEqual(['reference', 'public-interface'])
})
