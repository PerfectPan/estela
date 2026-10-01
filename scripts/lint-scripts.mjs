#!/usr/bin/env node
// Lints the root scripts/ directory, which no Rush project's lint covers, with the root .oxlintrc.json.
// oxlint is owned by apps/cli, like oxfmt for format.mjs. This script resolves it from that package.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HELP = `Usage:
  node scripts/lint-scripts.mjs [--help]

Runs oxlint with the root .oxlintrc.json (curly included) over the JS files in
scripts/. Exits 1 on a lint error; warnings are printed and do not fail, as in
"rush lint".

oxlint comes from apps/cli's devDependencies; run
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
  bin = join(dirname(require.resolve('oxlint/package.json')), 'bin/oxlint')
} catch {
  process.stderr.write(
    'lint-scripts: oxlint is not installed. Run "node common/scripts/install-run-rush.js install".\n',
  )
  process.exit(1)
}

// Type-aware rules run through tsgolint. Rush installs no root node_modules, so point oxlint at apps/cli's copy.
const env = { ...process.env, OXLINT_TSGOLINT_PATH: join(root, 'apps/cli/node_modules/.bin') }
const result = spawnSync(process.execPath, [bin, '-c', '.oxlintrc.json', 'scripts'], {
  cwd: root,
  env,
  stdio: 'inherit',
})
if (result.error) {
  throw result.error
}
process.exit(result.status ?? 1)
