import { notFound } from '@tanstack/react-router'
import type { DocsPageMeta } from './docs-head.ts'
import { source } from './source.ts'

/** Loads the English page metadata used for static `<head>` tags without importing the docs layout bundle. */
export function docsPageMeta(slugs: readonly string[], canonicalPath: string): DocsPageMeta {
  const page = source.getPage([...slugs], 'en')
  if (!page?.data.title) {
    throw notFound()
  }
  return {
    title: page.data.title,
    canonicalPath,
  }
}
