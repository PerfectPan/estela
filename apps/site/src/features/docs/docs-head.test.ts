import { describe, expect, it } from 'vite-plus/test'
import { SITE_ORIGIN } from '@/content/links.ts'
import { docsHead } from './docs-head.ts'

// Catches regressions in docs `<title>`, description, or canonical URL construction.
describe('docsHead', () => {
  it('formats page title, site description, and canonical URL under SITE_ORIGIN and BASE_URL', () => {
    const head = docsHead({ title: 'User Guide', canonicalPath: '/docs/guide/' })
    const expectedCanonical = new URL('docs/guide/', `${SITE_ORIGIN}${import.meta.env.BASE_URL}`).href
    expect(head.meta).toContainEqual({ title: 'User Guide · Estela' })
    expect(head.meta).toContainEqual(expect.objectContaining({ name: 'description' }))
    expect(head.links).toEqual([{ rel: 'canonical', href: expectedCanonical }])
  })
})
