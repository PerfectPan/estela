import type { VirtualFile } from 'fumadocs-core/source'
import { loader, update } from 'fumadocs-core/source'
import { pageSchema } from 'fumadocs-core/source/schema'
import { defineDocs } from 'fumadocs-mdx/macro'
import { dictionaryOf } from '@/i18n/locale.ts'
import { docsI18n } from '@/i18n/translations.ts'
import { extractDocTitle } from './doc-title.ts'
import { docsUrl } from './docs-path.ts'
import { readmeSlugs } from './readme-slugs.ts'

export const docs = defineDocs({
  dir: '../../docs',
  docs: {
    // Keep this literal list paired with `INCLUDED_DOC` and `isIncludedDoc` in `remark-docs.ts`.
    files: ['guide/*.md', 'reference/*.md', 'architecture/*.md', 'design/README.md'],
    async: true,
    schema: ({ path, source }) =>
      pageSchema.extend({
        title: pageSchema.shape.title.default(extractDocTitle(source, path)),
      }),
  },
})

const enDict = dictionaryOf('en')
const zhDict = dictionaryOf('zh-CN')

const ROOT_PAGES = ['guide', 'reference', 'architecture/overview', 'design/README', '...']
const GUIDE_PAGES = [
  'README',
  'getting-started',
  'concepts',
  'workspace',
  'supported-agents',
  'exports',
  'mcp',
  'dsh-plugin',
  'privacy',
  'troubleshooting',
  '...',
]
const REFERENCE_PAGES = ['public-interface', 'mcp-tools', 'export-formats', '...']

function metaPairs(prefix: string, pages: string[], titles?: Record<'en' | 'zh-CN', string>): VirtualFile[] {
  return (['en', 'zh-CN'] as const).map(locale => ({
    type: 'meta',
    path: locale === 'en' ? `${prefix}meta.json` : `${prefix}meta.zh-CN.json`,
    data: titles ? { title: titles[locale], defaultOpen: true, pages } : { pages },
  }))
}

const META_FILES: VirtualFile[] = [
  ...metaPairs('', ROOT_PAGES),
  ...metaPairs('guide/', GUIDE_PAGES, { en: enDict.docsSidebar.guide, 'zh-CN': zhDict.docsSidebar.guide }),
  ...metaPairs('reference/', REFERENCE_PAGES, {
    en: enDict.docsSidebar.reference,
    'zh-CN': zhDict.docsSidebar.reference,
  }),
]

export const source = loader({
  baseUrl: '/docs',
  i18n: docsI18n,
  slugs: readmeSlugs,
  url: slugs => docsUrl(slugs),
  pageTree: {
    transformers: [
      {
        file(node) {
          if (node.url === '/docs/design' || node.url === '/docs/design/') {
            const locale = this.locale === 'zh-CN' ? 'zh-CN' : 'en'
            return { ...node, name: dictionaryOf(locale).docsSidebar.design }
          }
          return node
        },
      },
    ],
  },
  source: update(docs.toFumadocsSource())
    .files(files => [...files, ...META_FILES])
    .build(),
})
