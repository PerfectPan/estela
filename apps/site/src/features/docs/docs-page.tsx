import { Suspense } from 'react'
import { notFound } from '@tanstack/react-router'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { useLanguage } from '@/hooks/use-language.ts'
import { DocsArticle } from './docs-article.tsx'
import { englishFallback } from './docs-fallback.ts'
import { slugsFromSplat } from './docs-path.ts'
import { DocsSidebarFooter } from './docs-sidebar-footer.tsx'
import { baseOptions } from './layout-shared.ts'
import { source } from './source.ts'
import { useSettledDocsLocale } from './use-settled-docs-locale.ts'

export function DocsScreen({ splat }: { splat?: string }) {
  const { lang } = useLanguage()
  const slugs = slugsFromSplat(splat)
  const splatKey = slugs.join('/')
  const targetPage = source.getPage(slugs, lang)
  if (!targetPage) {
    throw notFound()
  }

  // Keep the currently visible locale (both sidebar and article) mounted while switching or retrying
  // until the target MDX module finishes loading.
  const { activeLang, loadError, retry } = useSettledDocsLocale({
    splatKey,
    lang,
    targetPath: targetPage.path,
  })
  const page = source.getPage(slugs, activeLang)
  if (!page) {
    throw notFound()
  }

  return (
    // Hidden until the Chinese page is ready. Tailwind needs DOCS_PENDING_CLASS spelled out here.
    <div data-docs="" className="in-[.estela-docs-pending]:invisible">
      <DocsLayout
        {...baseOptions()}
        tree={source.getPageTree(activeLang)}
        sidebar={{
          className: 'bg-fd-background border-e-fd-border/60',
          footer: <DocsSidebarFooter />,
        }}
      >
        <Suspense>
          <DocsArticle
            path={page.path}
            fallback={englishFallback(activeLang, page.path)}
            lang={activeLang}
            inTargetLang={activeLang === lang}
            targetLang={lang}
            loadError={loadError}
            onRetry={retry}
          />
        </Suspense>
      </DocsLayout>
    </div>
  )
}
