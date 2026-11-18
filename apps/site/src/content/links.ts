import type { Locale } from '@/i18n/locale.ts'

/** GitHub Pages origin of the project site; the path below it is the build's base (`ESTELA_SITE_BASE`). */
export const SITE_ORIGIN = 'https://perfectpan.github.io'
export const REPOSITORY = 'https://github.com/PerfectPan/estela'
export const NPM = 'https://www.npmjs.com/package/@rivus/estela'
export const INSTALL_COMMAND = 'npx @rivus/estela'

const blob = (path: string) => `${REPOSITORY}/blob/main/${path}`

/** Docs the page links to, by the `id` of `docs.links` in the dictionaries. */
export const DOC_LINKS: Record<string, Record<Locale, string>> = {
  readme: { en: blob('README.md'), 'zh-CN': blob('README.zh-CN.md') },
  guide: { en: blob('docs/guide/README.md'), 'zh-CN': blob('docs/guide/README.md') },
  architecture: { en: blob('docs/architecture/overview.md'), 'zh-CN': blob('docs/architecture/overview.md') },
  design: { en: blob('docs/design/README.md'), 'zh-CN': blob('docs/design/README.md') },
  contributing: { en: blob('CONTRIBUTING.md'), 'zh-CN': blob('CONTRIBUTING.md') },
}

export const CHANGELOG = blob('apps/cli/CHANGELOG.md')
export const SECURITY = blob('SECURITY.md')
