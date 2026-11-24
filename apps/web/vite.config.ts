import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite-plus'

const clientRoot = fileURLToPath(new URL('src', import.meta.url))
const FONTSOURCE_IMPORT = /^\s*@import\s+["']@fontsource\/[^"']+["']\s*;\s*$/gm

/**
 * Embed builds inject no `@font-face` rules or webfont files: the embedded workspace uses the
 * fallback families of `--font-sans` and `--font-mono`, leaving the host page's font namespace untouched.
 */
function stripEmbedFonts() {
  return {
    name: 'estela-embed-no-fonts',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]?.replaceAll('\\', '/')
      if (file?.endsWith('/styles.css')) {
        return code.replace(FONTSOURCE_IMPORT, '')
      }
      return undefined
    },
  }
}

export default defineConfig(({ mode }) => {
  const embed = mode === 'embed'
  return {
    base: './',
    root: clientRoot,
    define: embed ? { 'process.env.NODE_ENV': '"production"' } : undefined,
    plugins: [...(embed ? [stripEmbedFonts()] : []), solid(), tailwindcss()],
    resolve: {
      alias: {
        '@': clientRoot,
      },
    },
    build: embed
      ? {
          outDir: fileURLToPath(new URL('dist-embed', import.meta.url)),
          emptyOutDir: true,
          lib: {
            entry: fileURLToPath(new URL('src/embed/index.ts', import.meta.url)),
            formats: ['es'],
            fileName: () => 'index.js',
          },
          rolldownOptions: {
            output: { codeSplitting: false },
          },
        }
      : {
          outDir: fileURLToPath(new URL('dist', import.meta.url)),
          emptyOutDir: true,
          rolldownOptions: {
            // One script: the report inlines it into `index.html`, and a page opened from `file://` cannot
            // load a split chunk (DevFrame's client imports its browser-agent bridge lazily).
            output: { codeSplitting: false },
          },
        },
    test: {
      // Plain-module tests run in Node; component tests opt into happy-dom via `@vitest-environment`.
      environment: 'node',
      // Relative to `root`, which is `src`; `../test` holds integration tests over built artifacts.
      include: ['**/*.test.{ts,tsx}', '../test/**/*.test.{ts,tsx}'],
    },
  }
})
