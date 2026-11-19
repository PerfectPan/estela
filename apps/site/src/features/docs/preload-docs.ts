import { loadDoc } from './doc-loader.ts'
import { docsSplatFromPathname, slugsFromSplat } from './docs-path.ts'
import { source } from './source.ts'

/** Preloads the English and (when active) Chinese MDX modules for `pathname` before `hydrateRoot`. */
export async function preloadDocsForLocation(pathname: string, htmlLang: string): Promise<void> {
  const slugs = slugsFromSplat(docsSplatFromPathname(pathname))
  const paths = new Set<string>()
  const enPage = source.getPage(slugs, 'en')
  if (enPage) {
    paths.add(enPage.path)
  }
  if (htmlLang === 'zh-CN') {
    const zhPage = source.getPage(slugs, 'zh-CN')
    if (zhPage) {
      paths.add(zhPage.path)
    }
  }
  await Promise.allSettled([...paths].map(path => loadDoc(path)))
}
