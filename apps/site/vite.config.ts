import process from 'node:process'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { index, rootRoute, route } from '@tanstack/virtual-file-routes'
import react from '@vitejs/plugin-react'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
import { defineConfig } from 'vite-plus'
import { normalizeBasePath } from './src/lib/site.ts'

const srcRoot = fileURLToPath(new URL('src', import.meta.url))

/** `ESTELA_SITE_BASE` (default `/estela/`), with the leading and trailing slash Vite expects. */
function siteBase(): string {
  const value = process.env.ESTELA_SITE_BASE ?? '/estela/'
  const trimmed = value.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? '/' : `/${trimmed}/`
}

const base = siteBase()

export default defineConfig({
  // GitHub Pages serves a project site under /<repository>/; the router basepath follows this base.
  base,
  resolve: {
    alias: {
      '@': srcRoot,
    },
  },
  plugins: [
    fumadocsMdx(),
    tailwindcss(),
    tanstackStart({
      router: {
        // Virtual routes: the file-route convention names (`__root.tsx`) are not kebab-case.
        virtualRouteConfig: rootRoute('root.tsx', [
          index('home.tsx'),
          route('/docs', [index('docs/index.tsx'), route('$', 'docs/page.tsx')]),
        ]),
        generatedRouteTree: './route-tree.gen.ts',
        basepath: normalizeBasePath(base),
        quoteStyle: 'single',
        semicolons: false,
      },
      prerender: {
        enabled: true,
        autoSubfolderIndex: true,
        crawlLinks: true,
        failOnError: true,
        // /demo/ is the CLI's report, written after this build by scripts/build-demo.mjs; it is not a route.
        filter: ({ path }) => !/\/demo\/?$/.test(path),
      },
      pages: [{ path: '/' }, { path: '/docs' }],
    }),
    react(),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
