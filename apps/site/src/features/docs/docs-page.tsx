import { Suspense, useEffect, useState } from 'react'
import { notFound } from '@tanstack/react-router'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import type { Locale } from '@/i18n/locale.ts'
import { useLanguage } from '@/hooks/use-language.ts'
import { isDocLoaded, loadDoc } from './doc-loader.ts'
import { DocsArticle } from './docs-article.tsx'
import { englishFallback } from './docs-fallback.ts'
import { slugsFromSplat } from './docs-path.ts'
import { DocsSidebarFooter } from './docs-sidebar-footer.tsx'
import { baseOptions } from './layout-shared.ts'
import { source } from './source.ts'

export function DocsScreen({ splat }: { splat?: string }) {
  const { lang } = useLanguage()
  const slugs = slugsFromSplat(splat)
  const splatKey = slugs.join('/')
  const [settled, setSettled] = useState<{ splatKey: string; lang: Locale }>({ splatKey, lang })
  const targetPage = source.getPage(slugs, lang)
  if (!targetPage) {
    throw notFound()
  }

  // Keep the currently visible locale (both sidebar and article) mounted until the target locale's MDX module
  // finishes loading, so a slow chunk never blanks the article or strands a dehydrated <Suspense> transition.
  const sameRoute = settled.splatKey === splatKey
  const targetLoaded = isDocLoaded(targetPage.path)
  const activeLang = sameRoute && settled.lang !== lang && !targetLoaded ? settled.lang : lang
  const page = source.getPage(slugs, activeLang)
  if (!page) {
    throw notFound()
  }

  useEffect(() => {
    let cancelled = false
    void loadDoc(targetPage.path).then(
      () => {
        if (!cancelled && (settled.splatKey !== splatKey || settled.lang !== lang)) {
          setSettled({ splatKey, lang })
        }
      },
      () => {
        // Rejection evicts the entry in doc-loader; keep the settled locale visible instead of blanking.
      },
    )
    return () => {
      cancelled = true
    }
  }, [targetPage.path, splatKey, lang, settled.splatKey, settled.lang])

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
          <DocsArticle path={page.path} fallback={englishFallback(activeLang, page.path)} lang={activeLang} />
        </Suspense>
      </DocsLayout>
    </div>
  )
}
