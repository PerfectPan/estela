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
    rollupOptions: {
      onwarn(warning, warn) {
        // zod places two `@__PURE__` comments where Rollup cannot read them; Rollup only drops the
        // comments. Rush treats any build warning as a failure, so this one is filtered out.
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('/zod/'))
          return
        warn(warning)
      },
    },
  },
})
