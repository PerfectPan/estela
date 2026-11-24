import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite-plus'

const clientRoot = fileURLToPath(new URL('src', import.meta.url))

export default defineConfig({
  base: './',
  root: clientRoot,
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      '@': clientRoot,
    },
  },
  build: {
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
    // Relative to `root`, which is `src`.
    include: ['**/*.test.{ts,tsx}'],
  },
})
