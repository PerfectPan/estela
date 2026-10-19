import { defineConfig } from 'vite-plus'

// `test:smoke` only: it packs and installs the CLI, so it is not part of the root `pnpm test`.
export default defineConfig({
  test: {
    include: ['src/**/*.smoke.ts'],
    reporters: ['verbose'],
    globalSetup: ['src/global-setup.ts'],
    hookTimeout: 300000,
    testTimeout: 120000,
  },
})
