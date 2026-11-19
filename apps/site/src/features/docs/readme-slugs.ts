/** Maps `folder/README.md` to its folder slug so `guide/README.md` serves at `/docs/guide`. */
export function readmeSlugs(_file: unknown, getDefaultSlugs: () => string[]): string[] {
  const slugs = getDefaultSlugs()
  if (slugs.at(-1) === 'README') {
    return slugs.slice(0, -1)
  }
  return slugs
}
