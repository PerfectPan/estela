import { dictionaryOf } from '@/i18n/locale.ts'
import { absoluteSiteUrl } from '@/landing/page-head.ts'

export interface DocsPageMeta {
  title: string
  canonicalPath: string
}

/** `<title>`, site description, and canonical link under `SITE_ORIGIN` plus base path for a docs route. */
export function docsHead(meta: DocsPageMeta | undefined) {
  const description = dictionaryOf('en').meta.description
  if (!meta) {
    return {
      meta: [{ title: 'Estela' }, { name: 'description', content: description }],
    }
  }
  return {
    meta: [{ title: `${meta.title} · Estela` }, { name: 'description', content: description }],
    links: [{ rel: 'canonical', href: absoluteSiteUrl(meta.canonicalPath) }],
  }
}
