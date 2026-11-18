import { SITE_ORIGIN } from '@/content/links.ts'
import { dictionaryOf } from '@/i18n/locale.ts'

/** Absolute URL of a page or file under the site base; Open Graph and canonical links need the origin. */
function absolute(path: string): string {
  return new URL(path.replace(/^\//, ''), `${SITE_ORIGIN}${import.meta.env.BASE_URL}`).href
}

/** Title, description, canonical link, and the Open Graph and Twitter cards of the landing page. */
export function pageHead() {
  const t = dictionaryOf('en')
  const url = absolute('/')
  const image = absolute('/og-image.png')
  return {
    meta: [
      { title: t.meta.title },
      { name: 'description', content: t.meta.description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Estela' },
      { property: 'og:title', content: t.meta.title },
      { property: 'og:description', content: t.meta.description },
      { property: 'og:url', content: url },
      { property: 'og:locale', content: 'en_US' },
      { property: 'og:image', content: image },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: t.hero.scene.label },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: t.meta.title },
      { name: 'twitter:description', content: t.meta.description },
      { name: 'twitter:image', content: image },
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}
