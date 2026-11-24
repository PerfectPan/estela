import { fileURLToPath } from 'node:url'
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vite-plus'
import { thirdPartyNotices } from '../../scripts/third-party-notices.mjs'

const webSrc = fileURLToPath(new URL('../web/src', import.meta.url))

// Rolldown only warns about an import it cannot resolve and leaves it external, which would ship a broken bundle.
const failOnWarn = true

const PLUGIN_NOTICES_INTRO: readonly string[] = [
  'dist/host.mjs bundles the packages in the first section; rolldown is listed there',
  'for the runtime helpers it writes into it. dist/client.js is built from the packages in the second',
  'section; it may list a package whose code was tree-shaken away.',
  'react is supplied by DeepSeek Harness at runtime through its module loader.',
  'The last section covers code adapted into the Estela sources themselves.',
]

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      '@': webSrc,
    },
  },
  pack: [
    {
      entry: { host: './src/host/index.ts' },
      target: 'node24',
      failOnWarn,
      deps: { alwaysBundle: [/^@rivus\//, 'zod', 'es-toolkit'] },
      plugins: [
        thirdPartyNotices({
          packageName: '@rivus/dsh-estela',
          bundleLabel: 'dist/host.mjs',
          webLabel: 'dist/client.js',
          intro: PLUGIN_NOTICES_INTRO,
          packPackage: fileURLToPath(new URL('.', import.meta.url)),
        }),
      ],
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 120000,
  },
})
