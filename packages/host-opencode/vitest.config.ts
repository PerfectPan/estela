import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // node:sqlite prints an ExperimentalWarning on early Node 24 releases. Rush treats any stderr as a warning and exits 1.
    poolOptions: { forks: { execArgv: ['--disable-warning=ExperimentalWarning'] } },
  },
})
