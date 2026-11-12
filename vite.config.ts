// Repository-wide lint and format settings. `vp lint` and `vp fmt` use the nearest vite.config.ts with a `lint` or
// `fmt` block, so every workspace package, whose own vite.config.ts has neither, lints and formats with this one;
// override globs are relative to this directory.
//
// The workspace root installs no dependencies, so nothing here is imported by package name. Every workspace package
// declares @perfectpan/lint-config at the same version; packages/schema's copy is used because every project depends
// on schema, so any install includes its node_modules. For the same reason this file does not call vite-plus's
// `defineConfig`.
import { fmt, lint } from './packages/schema/node_modules/@perfectpan/lint-config/vite-plus.js'

/** packages/server reads sessions through the kit; elsewhere its types come in through `import type`. */
const agentKitTypesOnly = {
  group: ['@rivus/agent-kit', '@rivus/agent-kit/**'],
  allowTypeImports: true,
  message: 'Only packages/server reads sessions through agent-kit at runtime; use import type.',
}

/** apps/cli imports only the kit's redaction and Node platform at runtime, for its terminal lines and exports. */
const agentKitCliEntries = {
  group: ['@rivus/agent-kit', '@rivus/agent-kit/**', '!@rivus/agent-kit/redact', '!@rivus/agent-kit/node'],
  allowTypeImports: true,
  message:
    'apps/cli imports only @rivus/agent-kit/redact and @rivus/agent-kit/node at runtime; read sessions through @rivus/estela-server.',
}

export default {
  lint: {
    ...lint,
    ignorePatterns: ['**/dist/**', '**/node_modules/**'],
    rules: {
      ...lint.rules,
      // Vitest's `expect(value, message)` takes a failure message.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
    },
    overrides: [
      ...lint.overrides,
      {
        // A later override that sets no-restricted-imports replaces these options, so it repeats this pattern.
        files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
        excludeFiles: ['apps/cli/**', 'packages/server/**'],
        rules: {
          'no-restricted-imports': ['error', { patterns: [agentKitTypesOnly] }],
        },
      },
      {
        files: ['apps/cli/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
        rules: {
          'no-restricted-imports': ['error', { patterns: [agentKitCliEntries] }],
        },
      },
      {
        // No Node built-ins in the browser-safe core outside tests.
        files: [
          'packages/schema/src/**/*.{ts,mts,cts,tsx}',
          'packages/kernel/src/**/*.{ts,mts,cts,tsx}',
          'packages/rpc/src/**/*.{ts,mts,cts,tsx}',
        ],
        excludeFiles: ['**/*.test.{ts,mts,cts,tsx}'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              paths: [
                'fs',
                'fs/promises',
                'path',
                'path/promises',
                'os',
                'os/promises',
                'url',
                'url/promises',
                'process',
                'process/promises',
                'child_process',
                'child_process/promises',
                'crypto',
                'crypto/promises',
                'util',
                'util/promises',
                'stream',
                'stream/promises',
                'buffer',
                'buffer/promises',
              ],
              patterns: [{ group: ['node:*', 'node:*/**'] }, agentKitTypesOnly],
            },
          ],
          'no-restricted-globals': ['error', 'process', 'Buffer'],
        },
      },
      {
        // One Icon base and the stroke icons built on it: a component family, which lint-config's
        // README exempts from one component per file (like a shadcn/ui file).
        files: ['apps/web/src/components/icons.tsx'],
        plugins: ['react'],
        rules: { 'react/no-multi-comp': 'off' },
      },
      {
        files: ['**/*.test.{ts,mts,cts,tsx}'],
        rules: {
          'no-restricted-globals': 'off',
        },
      },
    ],
  },
  fmt: {
    ...fmt,
    printWidth: 120,
    tabWidth: 2,
    useTabs: false,
    semi: false,
    singleQuote: true,
    jsxSingleQuote: false,
    quoteProps: 'as-needed',
    trailingComma: 'all',
    arrowParens: 'avoid',
    bracketSpacing: true,
    experimentalOperatorPosition: 'start',
    embeddedLanguageFormatting: 'off',
    ignorePatterns: ['**/fixtures/**', 'docs/**', '**/*.md', '**/*.json', '**/*.html', '**/*.css'],
  },
}
