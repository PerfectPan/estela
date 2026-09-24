import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

const clientRoot = dirname(fileURLToPath(import.meta.url))

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
    outDir: join(clientRoot, '../dist'),
    emptyOutDir: true,
  },
})
