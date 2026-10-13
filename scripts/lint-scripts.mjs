#!/usr/bin/env node
// Lints the root scripts/ directory and the root vite.config.ts, which no Rush project's lint covers, with `vp lint`
// and the `lint` block of the root vite.config.ts. vite-plus is resolved from apps/cli, as in format.mjs.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HELP = `Usage:
  node scripts/lint-scripts.mjs [--help]

Runs "vp lint" with the lint block of the root vite.config.ts (curly included)
over the JS files in scripts/ and the root vite.config.ts. Exits 1 on a lint
error or warning (the shared config sets denyWarnings), as in "rush lint".

vite-plus comes from apps/cli's devDependencies; run
"node common/scripts/install-run-rush.js install" first.
`

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}
if (args.length) {
  process.stderr.write(`lint-scripts: unknown argument ${args[0]}\n\n${HELP}`)
  process.exit(2)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))

let bin
try {
  const require = createRequire(join(root, 'apps/cli/package.json'))
  bin = join(dirname(require.resolve('vite-plus/package.json')), 'bin/vp')
} catch {
  process.stderr.write(
    'lint-scripts: vite-plus is not installed. Run "node common/scripts/install-run-rush.js install".\n',
  )
  process.exit(1)
}

const result = spawnSync(process.execPath, [bin, 'lint', 'scripts', 'vite.config.ts'], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) {
  throw result.error
}
process.exit(result.status ?? 1)
