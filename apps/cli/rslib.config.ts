import { defineConfig } from '@rslib/core'
import { ThirdPartyNotices } from './scripts/third-party-notices.ts'

// D11: one bundled package. Every @rivus/* workspace package and @clack/prompts are
// devDependencies and get bundled; `dependencies` (devframe, @devframes/agentic, cac) stay
// external through rslib's autoExternal.
export default defineConfig({
  lib: [
    {
      id: 'cli',
      source: { entry: { cli: './src/main.ts' } },
      output: {
        copy: [
          { from: '../web/dist', to: 'web' },
          { from: '../../fixtures/demo.trace.json', to: 'fixtures/demo.trace.json' },
        ],
      },
      tools: {
        rspack: (_config, { appendPlugins }) => {
          appendPlugins(new ThirdPartyNotices({ webPackage: '../web', sourceNotices: '../../third-party-notices.md' }))
        },
      },
    },
    {
      // Node 20 must parse this file: it checks the version before it loads `cli.mjs`.
      id: 'bin',
      syntax: 'es2022',
      source: { entry: { bin: './bin.mjs' } },
      output: { externals: ['./cli.mjs'] },
      tools: {
        // Keep the sqlite-warning filter in `bin.mjs` instead of a separate chunk.
        rspack: { module: { parser: { javascript: { dynamicImportMode: 'eager' } } } },
      },
    },
  ],
  source: {
    define: { AGENT_TRACE_BUNDLE: 'true' },
  },
  output: {
    filename: { js: '[name].mjs' },
  },
})
