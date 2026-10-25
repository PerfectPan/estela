// Repository-wide lint and format settings. `vp lint` and `vp fmt` use the nearest vite.config.ts with a `lint` or
// `fmt` block, so every workspace package, whose own vite.config.ts has neither, lints and formats with this one;
// override globs are relative to this directory.
//
// The workspace root installs no dependencies, so nothing here is imported by package name. Every workspace package
// declares @perfectpan/lint-config at the same version; packages/schema's copy is used because every project depends
// on schema, so any install includes its node_modules. For the same reason this file does not call vite-plus's
// `defineConfig`.
import { fmt, lint } from './packages/schema/node_modules/@perfectpan/lint-config/vite-plus.js'

/** Only apps/cli imports the kit at runtime; elsewhere its types come in through `import type`. */
const agentKitTypesOnly = {
  group: ['@rivus/agent-kit', '@rivus/agent-kit/**'],
  allowTypeImports: true,
  message: 'Only apps/cli may import agent-kit at runtime; use import type.',
}

export default {
  lint: {
    ...lint,
    ignorePatterns: ['**/dist/**', '**/node_modules/**'],
    categories: { ...lint.categories, suspicious: 'warn' },
    rules: {
      ...lint.rules,
      // Declared return types already cover this, and the rule does not follow
      // `never` calls such as `process.exit` or exhaustive switches.
      'typescript/consistent-return': 'off',
      // Vitest's `expect(value, message)` takes a failure message.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      // Fire-and-forget `.then` at the end of a chain has nothing to return.
      'promise/always-return': ['warn', { ignoreLastCallback: true }],
      'import/no-unassigned-import': ['warn', { allow: ['**/*.css'] }],
      // agent-kit's Result errors carry their discriminator as `_tag`.
      'eslint/no-underscore-dangle': ['warn', { allow: ['_tag'] }],
      // Under verbatimModuleSyntax, `import { type X } from 'm'` compiles to `import 'm'`, so the
      // module still loads at runtime. `allowTypeImports` in the agent-kit override below accepts
      // that form; this rule requires `import type { X }` instead.
      'typescript/no-import-type-side-effects': 'error',
    },
    overrides: [
      ...lint.overrides,
      {
        // A later override that sets no-restricted-imports replaces these options, so it repeats this pattern.
        files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
        excludeFiles: ['apps/cli/**'],
        rules: {
          'no-restricted-imports': ['error', { patterns: [agentKitTypesOnly] }],
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
