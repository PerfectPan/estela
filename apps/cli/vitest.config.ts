import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 120000,
    // node:sqlite (session index) prints an ExperimentalWarning on early Node 24 releases. Rush treats any stderr as a warning and exits 1.
    // The setup file drops only that warning; it runs before any test file loads node:sqlite.
    setupFiles: ['@rivus/agent-trace-runtime-node/sqlite-warning'],
  },
})
