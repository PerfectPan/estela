import { defineConfig } from 'fumadocs-mdx/config'
import { remarkDocsPost, remarkDocsPre } from './src/features/docs/remark-docs.ts'

export default defineConfig({
  mdxOptions: {
    remarkPlugins: defaults => [remarkDocsPre, ...defaults, remarkDocsPost],
  },
})
