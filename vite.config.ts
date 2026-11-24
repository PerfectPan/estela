// Repository-wide lint and format settings. `vp lint` and `vp fmt` use the nearest vite.config.ts with a `lint` or
// `fmt` block, so every workspace package, whose own vite.config.ts has neither, lints and formats with this one;
// override globs are relative to this directory.
//
// The workspace root installs only the Changesets tools, not lint-config or vite-plus, so nothing here is imported by
// package name. Every workspace package
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

/**
 * The kernel may also import the kit's cost entries at runtime: `/cost` (pricing math) and `/cost/prices` (the
 * LiteLLM snapshot) import nothing, so the browser bundle stays free of the kit's readers. Everything else stays
 * type-only.
 */
const agentKitCostOnly = {
  ...agentKitTypesOnly,
  group: [...agentKitTypesOnly.group, '!@rivus/agent-kit/cost', '!@rivus/agent-kit/cost/prices'],
  message:
    'Only packages/server reads sessions through agent-kit at runtime; the kernel may import /cost and /cost/prices.',
}

const nodeBuiltins = [
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
]

export default {
  lint: {
    ...lint,
    // `*.gen.ts`: TanStack Router's generated route tree; `.source/**`: Fumadocs MDX generated collections (`apps/site`).
    ignorePatterns: ['**/dist/**', '**/node_modules/**', '**/*.gen.ts', '**/.source/**'],
    rules: {
      ...lint.rules,
      // Vitest's `expect(value, message)` takes a failure message.
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      // The smoke suites assert through the shared `expectCleanOutput`; type-level tests assert through expectTypeOf.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expectTypeOf', 'expectCleanOutput'] }],
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
        files: ['packages/kernel/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
        rules: {
          'no-restricted-imports': ['error', { patterns: [agentKitCostOnly] }],
        },
      },
      {
        // No Node built-ins in the browser-safe core outside tests.
        files: ['packages/schema/src/**/*.{ts,mts,cts,tsx}', 'packages/rpc/src/**/*.{ts,mts,cts,tsx}'],
        excludeFiles: ['**/*.test.{ts,mts,cts,tsx}'],
        rules: {
          'no-restricted-imports': [
            'error',
            { paths: nodeBuiltins, patterns: [{ group: ['node:*', 'node:*/**'] }, agentKitTypesOnly] },
          ],
          'no-restricted-globals': ['error', 'process', 'Buffer'],
        },
      },
      {
        files: ['packages/kernel/src/**/*.{ts,mts,cts,tsx}'],
        excludeFiles: ['**/*.test.{ts,mts,cts,tsx}'],
        rules: {
          'no-restricted-imports': [
            'error',
            { paths: nodeBuiltins, patterns: [{ group: ['node:*', 'node:*/**'] }, agentKitCostOnly] },
          ],
          'no-restricted-globals': ['error', 'process', 'Buffer'],
        },
      },
      {
        // Keep the DevFrame-free core and its store free of DevFrame, the session catalog (which reaches
        // `node:sqlite` through the session index), and the root `@rivus/estela-rpc` barrel (which imports
        // DevFrame at top level).
        files: ['packages/server/src/core/**/*.{ts,mts,cts,tsx}', 'packages/server/src/store/**/*.{ts,mts,cts,tsx}'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              paths: [
                {
                  name: '@rivus/estela-rpc',
                  message:
                    'Import from @rivus/estela-rpc/trace-store instead so the DevFrame-free core never reaches the RPC barrel.',
                },
              ],
              patterns: [
                {
                  group: ['devframe', 'devframe/**'],
                  message: 'packages/server/src/core and store must not import devframe.',
                },
                {
                  group: ['../catalog', '../catalog/**', '**/catalog/**'],
                  message: 'packages/server/src/core and store must not import from packages/server/src/catalog/.',
                },
              ],
            },
          ],
        },
      },
      {
        // The dsh plugin's host half must not pull in DevFrame or the root server/rpc barrels,
        // and keeps @rivus/agent-kit type-only.
        files: ['apps/dsh-plugin/src/host/**/*.{ts,mts,cts,tsx}'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              paths: [
                {
                  name: '@rivus/estela-server',
                  message: 'Import from @rivus/estela-server/core instead so the dsh host stays DevFrame-free.',
                },
                {
                  name: '@rivus/estela-rpc',
                  message: 'Import from @rivus/estela-rpc/trace-store instead so the dsh host stays DevFrame-free.',
                },
              ],
              patterns: [
                agentKitTypesOnly,
                {
                  group: ['devframe', 'devframe/**'],
                  message: 'apps/dsh-plugin/src/host must not import devframe.',
                },
              ],
            },
          ],
        },
      },
      {
        // The dsh plugin's client half runs in the browser inside dsh's module loader: at runtime it
        // may import only from src/client/**, src/contract/**, @rivus/estela-web/embed, and react.
        files: ['apps/dsh-plugin/src/client/**/*.{ts,mts,cts,tsx}'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                agentKitTypesOnly,
                {
                  group: [
                    '*',
                    '**/*',
                    '!./*',
                    '!./**',
                    '!../contract/*',
                    '!../contract/**',
                    '!@rivus/estela-web/embed',
                    '!react',
                    '!react/jsx-runtime',
                  ],
                  allowTypeImports: true,
                  message:
                    'apps/dsh-plugin/src/client may import at runtime only from src/client/**, src/contract/**, @rivus/estela-web/embed, and react.',
                },
              ],
            },
          ],
        },
      },
      {
        // One Icon base and the stroke icons built on it: a component family, which lint-config's
        // README exempts from one component per file (like a shadcn/ui file).
        files: ['apps/web/src/components/icons.tsx', 'apps/site/src/components/icons.tsx'],
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
    ignorePatterns: [
      '**/fixtures/**',
      'docs/**',
      '**/*.md',
      '**/*.json',
      '**/*.html',
      '**/*.css',
      '**/*.gen.ts',
      '**/.source/**',
    ],
  },
}
