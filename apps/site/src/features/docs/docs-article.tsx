import { use } from 'react'
import { Callout } from 'fumadocs-ui/components/callout'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import type { Locale } from '@/i18n/locale.ts'
import { useDocumentReady } from '@/hooks/use-document-ready.ts'
import { useHashScroll } from '@/hooks/use-hash-scroll.ts'
import { DOCS_PENDING_CLASS } from '@/i18n/lang-preference.ts'
import { dictionaryOf } from '@/i18n/locale.ts'
import { cx } from '@/lib/cva.ts'
import { docs } from './source.ts'

// The TOC marks the current section with its track segment alone, without Fumadocs' travelling dot.
const TOC_LIST = { thumbBox: false }

export function DocsArticle({ path, fallback, lang }: { path: string; fallback: boolean; lang: Locale }) {
  const page = docs.getPage(path)
  if (!page) {
    throw new Error(`unknown page: ${path}`)
  }

  const loaded = use(page.load())
  const MDX = page.body
  const t = dictionaryOf(lang)

  useDocumentReady(path, lang === 'zh-CN', DOCS_PENDING_CLASS)
  useHashScroll(path, lang)

  return (
    <DocsPage
      toc={loaded.toc}
      tableOfContent={{ single: true, list: TOC_LIST }}
      tableOfContentPopover={{ list: TOC_LIST }}
    >
      <DocsTitle
        className={cx(
          'text-[2.25rem] leading-[1.15] font-semibold tracking-[-0.025em] text-balance',
          lang === 'zh-CN' && 'break-keep',
        )}
      >
        {page.title}
      </DocsTitle>
      {page.description === undefined ? null : <DocsDescription>{page.description}</DocsDescription>}
      <DocsBody
        className={cx(
          'max-w-[72ch] text-[1.03rem] leading-[1.7] text-pretty',
          lang === 'zh-CN' && '[line-break:strict]',
        )}
      >
        {fallback ? <Callout>{t.docsSidebar.fallbackNotice}</Callout> : null}
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  )
}
