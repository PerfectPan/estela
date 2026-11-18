import { createRootRoute } from '@tanstack/react-router'
import { languageBootScript } from '@/i18n/language-boot-script.ts'
import { RootShell } from '@/i18n/root-shell.tsx'
import favicon from '../../../../docs/assets/logo.svg?url'
import stylesheet from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light dark' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: favicon },
      { rel: 'stylesheet', href: stylesheet },
    ],
    scripts: [{ children: languageBootScript() }],
  }),
  component: RootShell,
})
