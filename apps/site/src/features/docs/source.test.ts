import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { source } from './source.ts'

function collectTreeEntries(
  nodes: ReturnType<typeof source.getPageTree>['children'],
): { url: string; name: unknown }[] {
  const entries: { url: string; name: unknown }[] = []
  for (const node of nodes) {
    if (node.type === 'page') {
      entries.push({ url: node.url, name: node.name })
    } else if (node.type === 'folder') {
      if (node.index) {
        entries.push({ url: node.index.url, name: node.index.name })
      }
      entries.push(...collectTreeEntries(node.children))
    }
  }
  return entries
}

function slugsForDocPath(relPath: string): string[] {
  const parts = relPath.replace(/(?:\.zh-CN)?\.md$/, '').split('/')
  if (parts.at(-1) === 'README') {
    parts.pop()
  }
  return parts
}

// Catches any matched doc omitted from the sidebar tree and ensures localized folder/label overrides apply.
describe('source page tree', () => {
  it('includes every file matched by source.ts globs in the en and zh-CN page trees', () => {
    const sourceFile = fileURLToPath(new URL('./source.ts', import.meta.url))
    const sourceText = readFileSync(sourceFile, 'utf8')
    const match = /\bfiles:\s*\[([^\]]*)\]/.exec(sourceText)
    expect(match).not.toBeNull()
    const globs = [...match![1]!.matchAll(/'([^']+)'/g)].map(item => item[1]!)

    const docsRoot = fileURLToPath(new URL('../../../../../docs', import.meta.url))
    const matched = globSync(globs, { cwd: docsRoot }).map(file => file.replaceAll('\\', '/'))
    expect(matched.length).toBeGreaterThan(0)

    const enEntries = collectTreeEntries(source.getPageTree('en').children)
    const zhEntries = collectTreeEntries(source.getPageTree('zh-CN').children)
    const enUrls = new Set(enEntries.map(entry => entry.url))
    const zhUrls = new Set(zhEntries.map(entry => entry.url))

    for (const relPath of matched) {
      const locale = relPath.endsWith('.zh-CN.md') ? 'zh-CN' : 'en'
      const page = source.getPage(slugsForDocPath(relPath), locale)
      expect(page, `missing page for ${relPath}`).toBeDefined()
      const urls = locale === 'zh-CN' ? zhUrls : enUrls
      expect(urls.has(page!.url), `${relPath} (${page!.url}) missing from ${locale} page tree`).toBe(true)
    }

    expect(enEntries.find(entry => entry.url === '/docs/design')?.name).toBe('Visual design')
    expect(zhEntries.find(entry => entry.url === '/docs/design')?.name).toBe('视觉设计')
  })
})
