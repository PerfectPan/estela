/** URL splat `a/b` -> `['a', 'b']`. Empty and trailing slashes drop out. */
export function slugsFromSplat(splat: string | undefined): string[] {
  return (splat ?? '').split('/').filter(part => part.length > 0)
}

/** Docs pathname for both languages, with trailing slash to match static `index.html` directories. */
export function docsUrl(slugs: readonly string[]): string {
  const path = slugs.filter(part => part.length > 0).join('/')
  return path.length === 0 ? '/docs/' : `/docs/${path}/`
}
