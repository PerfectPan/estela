import { normalizeBasePath } from '@/lib/site.ts'
import { loadDoc } from './doc-loader.ts'
import { slugsFromSplat } from './docs-path.ts'
import { source } from './source.ts'

/** Preloads the English and (when active) Chinese MDX modules for `pathname` before `hydrateRoot`. */
export async function preloadDocsForLocation(pathname: string, htmlLang: string): Promise<void> {
  const docsPrefix = `${normalizeBasePath(import.meta.env.BASE_URL)}/docs`
  const splat = pathname.startsWith(docsPrefix) ? pathname.slice(docsPrefix.length) : ''
  const slugs = slugsFromSplat(splat)
  const effectiveSlugs = slugs.length === 0 ? ['guide'] : slugs
  const paths = new Set<string>()
  const enPage = source.getPage(effectiveSlugs, 'en')
  if (enPage) {
    paths.add(enPage.path)
  }
  if (htmlLang === 'zh-CN') {
    const zhPage = source.getPage(effectiveSlugs, 'zh-CN')
    if (zhPage) {
      paths.add(zhPage.path)
    }
  }
  await Promise.allSettled([...paths].map(path => loadDoc(path)))
}
