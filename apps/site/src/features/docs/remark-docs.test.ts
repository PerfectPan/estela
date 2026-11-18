import { describe, expect, it } from 'vite-plus/test'
import { remarkDocsPre, rewriteDocLink } from './remark-docs.ts'

// Catches regressions where relative doc links stay broken `.md` paths, drop anchors, or fail to point repo links at GitHub.
describe('rewriteDocLink', () => {
  it('rewrites links to included docs (including .zh-CN.md and README) to site URLs with hashes', () => {
    expect(rewriteDocLink('concepts.md#model-saw', '/repo/docs/guide/getting-started.md')).toBe(
      '/docs/guide/concepts#model-saw',
    )
    expect(rewriteDocLink('../reference/mcp-tools.zh-CN.md#错误', '/repo/docs/guide/mcp.zh-CN.md')).toBe(
      '/docs/reference/mcp-tools#错误',
    )
    expect(rewriteDocLink('../guide/README.md', '/repo/docs/reference/public-interface.md')).toBe('/docs/guide')
    expect(rewriteDocLink('../guide/README.zh-CN.md', '/repo/docs/reference/public-interface.zh-CN.md')).toBe(
      '/docs/guide',
    )
    expect(rewriteDocLink('../design/README.md#tokens', '/repo/docs/guide/workspace.md')).toBe('/docs/design#tokens')
  })

  it('rewrites non-included relative repository links to GitHub blob URLs', () => {
    expect(rewriteDocLink('../../CONTRIBUTING.md#release-intent', 'docs/reference/public-interface.md')).toBe(
      'https://github.com/PerfectPan/estela/blob/main/CONTRIBUTING.md#release-intent',
    )
    expect(
      rewriteDocLink('../../packages/server/src/catalog/session-catalog.ts', 'docs/architecture/overview.md'),
    ).toBe('https://github.com/PerfectPan/estela/blob/main/packages/server/src/catalog/session-catalog.ts')
    expect(rewriteDocLink('../../skills/estela/SKILL.md', 'docs/guide/mcp.md')).toBe(
      'https://github.com/PerfectPan/estela/blob/main/skills/estela/SKILL.md',
    )
    expect(rewriteDocLink('session-workspace-dark.html', 'docs/design/README.md')).toBe(
      'https://github.com/PerfectPan/estela/blob/main/docs/design/session-workspace-dark.html',
    )
    expect(rewriteDocLink('../development/setup.md', 'docs/guide/getting-started.md')).toBe(
      'https://github.com/PerfectPan/estela/blob/main/docs/development/setup.md',
    )
    expect(rewriteDocLink('../assets/logo.svg', 'docs/design/README.md')).toBe(
      'https://github.com/PerfectPan/estela/blob/main/docs/assets/logo.svg',
    )
  })

  it('keeps absolute URLs and same-page anchors unchanged', () => {
    expect(rewriteDocLink('https://github.com/PerfectPan/estela', 'docs/guide/README.md')).toBe(
      'https://github.com/PerfectPan/estela',
    )
    expect(rewriteDocLink('#cost', 'docs/guide/workspace.md')).toBe('#cost')
  })
})

describe('remarkDocsPre', () => {
  it('strips the first H1 heading, rewrites links, and converts raw <img> HTML to image nodes', () => {
    const linkNode = { type: 'link', url: 'session-workspace-dark.html', children: [] }
    const tree = {
      type: 'root',
      children: [
        { type: 'heading', depth: 1, children: [{ type: 'text', value: 'DevTools visual design' }] },
        {
          type: 'paragraph',
          children: [linkNode],
        },
        { type: 'html', value: '<img src="../assets/logo.svg" width="128" height="128" alt="Estela logo">' },
      ],
    }
    remarkDocsPre()(tree, { path: '/repo/docs/design/README.md' })
    expect(tree.children).toHaveLength(2)
    expect(linkNode.url).toBe('https://github.com/PerfectPan/estela/blob/main/docs/design/session-workspace-dark.html')
    expect(tree.children[1]).toEqual({
      type: 'image',
      url: '../assets/logo.svg',
      alt: 'Estela logo',
      data: { estelaImgAttrs: { width: '128', height: '128' } },
    })
  })
})
