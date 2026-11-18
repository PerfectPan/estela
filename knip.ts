// The workspace root does not install lint-config (see vite.config.ts), so the shared
// Knip policy is imported from packages/schema's node_modules — the same copy the
// root lint/format config uses. The knip and jscpd binaries and their scripts live
// in @rivus/estela-schema for the same reason, and run with the workspace root as
// the working directory so the pnpm catalog resolves.
import { knip } from './packages/schema/node_modules/@perfectpan/lint-config/knip.js';

// Package entry points resolve from package.json bin/exports; apps/e2e runs
// Playwright specs and keeps its ad-hoc demo recorders as entries.
// Configuration and tag hints fail the run.
const config = {
  ...knip,
  // Every workspace package declares @perfectpan/lint-config at the same catalog
  // version per the repository convention: its rules load through the root
  // vite.config.ts when each package runs `vp lint`, which Knip cannot see.
  ignoreDependencies: ['@perfectpan/lint-config', 'vite-plus'],
  workspaces: {
    '.': {
      entry: ['fixtures/**/*'],
      project: ['fixtures/**/*']
    },
    'apps/cli': {
      // The dual-mode launcher: `./cli.mjs` only exists next to it in dist after
      // `vp pack` (see bin.mjs), so the file is excluded from import analysis.
      ignore: ['bin.mjs'],
      // Build order, not an import: `vp pack` copies apps/web/dist into the
      // package, so `pnpm --filter '@rivus/estela...' run build` (the smoke
      // suite and the Publish check) must build the web app first.
      ignoreDependencies: ['@rivus/estela-web']
    },
    'apps/e2e': {
      entry: ['src/demo/*.ts!']
    },
    'apps/web': {
      // shadcn/ui keeps a curated component set; entries so unused exports stay allowed there.
      entry: ['src/components/ui/**/*.tsx!'],
      // vite/client types resolve through the vite-plus core alias, and rolldown
      // pins the bundler version the Vite build uses.
      ignoreDependencies: ['vite', 'rolldown']
    },
    'packages/runtime-node': {},
    'packages/kernel': {},
    'packages/rpc': {},
    'packages/schema': {},
    'packages/server': {}
  }
};

export default config;
