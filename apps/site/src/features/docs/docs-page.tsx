import { Suspense } from 'react'
import { notFound } from '@tanstack/react-router'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { useLanguage } from '@/hooks/use-language.ts'
import type { DocsPageMeta } from './docs-head.ts'
import { englishFallback } from './docs-fallback.ts'
import { slugsFromSplat } from './docs-path.ts'
import { DocsArticle } from './docs-article.tsx'
import { DocsSidebarFooter } from './docs-sidebar-footer.tsx'
import { baseOptions } from './layout-shared.ts'
import { source } from './source.ts'

/** Loads the English page metadata used for static `<head>` tags, throwing `notFound` for unknown slugs. */
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

export function DocsScreen({ splat }: { splat?: string }) {
  const { lang } = useLanguage()
  const slugs = slugsFromSplat(splat)
  const page = source.getPage(slugs, lang)
  if (!page) {
    throw notFound()
  }

  return (
    // Hidden until the Chinese page is ready. Tailwind needs DOCS_PENDING_CLASS spelled out here.
    <div data-docs="" className="in-[.estela-docs-pending]:invisible">
      <DocsLayout
        {...baseOptions()}
        tree={source.getPageTree(lang)}
        sidebar={{
          className: 'bg-fd-background border-e-fd-border/60',
          footer: <DocsSidebarFooter />,
        }}
      >
        <Suspense>
          <DocsArticle path={page.path} fallback={englishFallback(lang, page.path)} lang={lang} />
        </Suspense>
      </DocsLayout>
    </div>
  )
}
