import { defineConfig } from '@rslib/core'

// D11: one bundled package. Every @rivus/* workspace package is a devDependency and is bundled;
// `dependencies` (devframe, @devframes/agentic, cac) stay external through rslib's autoExternal.
export default defineConfig({
  lib: [
    {
      id: 'cli',
      format: 'esm',
      syntax: 'es2023',
      bundle: true,
      dts: false,
      source: { entry: { cli: './src/main.ts' } },
      output: {
        copy: [
          { from: '../web/dist', to: 'web' },
          { from: '../../fixtures/demo.trace.json', to: 'fixtures/demo.trace.json' },
        ],
      },
    },
    {
      // Node 20 must parse this file: it checks the version before it loads `cli.mjs`.
      id: 'bin',
      format: 'esm',
      syntax: 'es2022',
      bundle: true,
      dts: false,
      source: { entry: { bin: './src/bundle-bin.mjs' } },
      output: { externals: ['./cli.mjs'] },
    },
  ],
  source: {
    define: { AGENT_TRACE_BUNDLE: 'true' },
  },
  output: {
    target: 'node',
    distPath: { root: 'dist' },
    filename: { js: '[name].mjs' },
    cleanDistPath: true,
  },
})
