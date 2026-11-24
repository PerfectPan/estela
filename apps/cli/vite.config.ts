import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { thirdPartyNotices } from '../../scripts/third-party-notices.mjs'

const define = { ESTELA_BUNDLE: 'true' }
// Rolldown only warns about an import it cannot resolve and leaves it external, which would ship a broken bundle.
const failOnWarn = true

export default defineConfig({
  // One bundled package. Every @rivus/* workspace package, @clack/prompts, and @bomb.sh/router are devDependencies
  // and get bundled; `dependencies` (devframe, @devframes/agentic) stay external.
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
          packPackage: fileURLToPath(new URL('.', import.meta.url)),
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
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 120000,
  },
})
