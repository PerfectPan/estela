import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { thirdPartyNotices } from './scripts/third-party-notices.ts'

const define = { AGENT_TRACE_BUNDLE: 'true' }
// Rolldown only warns about an import it cannot resolve and leaves it external, which would ship a broken bundle.
const failOnWarn = true

export default defineConfig({
  // One bundled package. Every @rivus/* workspace package and @clack/prompts are devDependencies and get
  // bundled; `dependencies` (devframe, @devframes/agentic, cac) stay external.
  pack: [
    {
      entry: { cli: './src/main.ts' },
      define,
      failOnWarn,
      copy: [
        { from: '../web/dist', to: 'dist', rename: 'web' },
        { from: '../../fixtures/demo.trace.json', to: 'dist/fixtures' },
      ],
      plugins: [
        thirdPartyNotices({
          webPackage: fileURLToPath(new URL('../web', import.meta.url)),
          sourceNotices: fileURLToPath(new URL('../../third-party-notices.md', import.meta.url)),
        }),
      ],
    },
    {
      entry: { bin: './bin.mjs' },
      define,
      failOnWarn,
      // Node 20 must parse this file: it checks the version before it loads `cli.mjs`.
      target: 'es2022',
      deps: { neverBundle: ['./cli.mjs'] },
      // Keep the sqlite-warning filter in `bin.mjs` instead of a separate chunk.
      outputOptions: { codeSplitting: false },
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 120000,
  },
})
