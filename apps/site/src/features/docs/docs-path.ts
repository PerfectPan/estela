import { normalizeBasePath } from '@/lib/site.ts'

export const DEFAULT_DOCS_SPLAT = 'guide'

/** Normalized `/docs` path prefix under `baseUrl` (`'/docs'` or `'/estela/docs'`). */
function docsBasePrefix(baseUrl: string = import.meta.env.BASE_URL): string {
  return `${normalizeBasePath(baseUrl)}/docs`
}

/** True when `pathname` targets the docs index or any docs route under `baseUrl`. */
export function isDocsPath(pathname: string, baseUrl: string = import.meta.env.BASE_URL): boolean {
  const prefix = docsBasePrefix(baseUrl)
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Returns the directory pathname when a static `.../index.html` URL is opened directly, or `null`. */
export function stripIndexHtmlSuffix(pathname: string): string | null {
  if (!pathname.endsWith('/index.html')) {
    return null
  }
  return pathname.slice(0, -'index.html'.length)
}

/** Extracts the docs splat from `pathname`, defaulting bare `/docs/` to `DEFAULT_DOCS_SPLAT`. */
export function docsSplatFromPathname(pathname: string, baseUrl: string = import.meta.env.BASE_URL): string {
  const prefix = docsBasePrefix(baseUrl)
  const raw = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
  const trimmed = raw.replace(/^\/+|\/+$/g, '')
  if (trimmed.length === 0) {
    return DEFAULT_DOCS_SPLAT
  }
  try {
    return decodeURIComponent(trimmed)
  } catch {
    return trimmed
  }
}

/** URL splat `a/b` -> `['a', 'b']`. Empty and trailing slashes drop out. */
export function slugsFromSplat(splat: string | undefined): string[] {
  return (splat ?? '').split('/').filter(part => part.length > 0)
}

/** Docs pathname for both languages, with trailing slash to match static `index.html` directories. */
export function docsUrl(slugs: readonly string[]): string {
  const path = slugs.filter(part => part.length > 0).join('/')
  return path.length === 0 ? '/docs/' : `/docs/${path}/`
}
