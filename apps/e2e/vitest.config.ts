import { defineConfig } from 'vitest/config'

// `test:smoke` only: it packs and installs the CLI, so it is not part of `rush test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.smoke.ts'],
    reporters: ['verbose'],
    globalSetup: ['src/global-setup.ts'],
    hookTimeout: 300000,
    testTimeout: 120000,
  },
})
