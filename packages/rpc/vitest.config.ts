import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    // trace-store-gc.test.ts calls `gc()` to prove evicted traces are collectable.
    execArgv: ['--expose-gc'],
  },
})
