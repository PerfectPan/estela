import type { VirtualFile } from 'fumadocs-core/source'
import { loader, update } from 'fumadocs-core/source'
import { pageSchema } from 'fumadocs-core/source/schema'
import { defineDocs } from 'fumadocs-mdx/macro'
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

const META_FILES: VirtualFile[] = [
  {
    type: 'meta',
    path: 'meta.json',
    data: { pages: ['guide', 'reference', 'architecture/overview', 'design/README'] },
  },
  {
    type: 'meta',
    path: 'meta.zh-CN.json',
    data: { pages: ['guide', 'reference', 'architecture/overview', 'design/README'] },
  },
  {
    type: 'meta',
    path: 'guide/meta.json',
    data: {
      title: 'Guide',
      defaultOpen: true,
      pages: [
        'README',
        'getting-started',
        'concepts',
        'workspace',
        'supported-agents',
        'exports',
        'mcp',
        'privacy',
        'troubleshooting',
      ],
    },
  },
  {
    type: 'meta',
    path: 'guide/meta.zh-CN.json',
    data: {
      title: '用户指南',
      defaultOpen: true,
      pages: [
        'README',
        'getting-started',
        'concepts',
        'workspace',
        'supported-agents',
        'exports',
        'mcp',
        'privacy',
        'troubleshooting',
      ],
    },
  },
  {
    type: 'meta',
    path: 'reference/meta.json',
    data: { title: 'Reference', defaultOpen: true, pages: ['public-interface', 'mcp-tools', 'export-formats'] },
  },
  {
    type: 'meta',
    path: 'reference/meta.zh-CN.json',
    data: { title: '参考文档', defaultOpen: true, pages: ['public-interface', 'mcp-tools', 'export-formats'] },
  },
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
          if (node.url === '/docs/design') {
            return { ...node, name: this.locale === 'zh-CN' ? '视觉设计' : 'Visual design' }
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
