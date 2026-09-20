import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

const clientRoot = fileURLToPath(new URL('.', import.meta.url))

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
    outDir: fileURLToPath(new URL('../../dist/client', import.meta.url)),
    emptyOutDir: true,
  },
})
