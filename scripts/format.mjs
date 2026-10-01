#!/usr/bin/env node
// Formats the repository's JS and TS code with oxfmt and the root .oxfmtrc.json.
// oxfmt is owned by apps/cli, like @rslib/core for check-browser-bundle.mjs. This script resolves it from that package.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HELP = `Usage:
  node scripts/format.mjs [--check] [--help]

Formats the JS and TS files (.js .jsx .mjs .cjs .ts .tsx .mts .cts) that git
tracks or would track under apps/, packages/, and scripts/, with oxfmt and the
root .oxfmtrc.json. Fixtures are skipped; Markdown, JSON, HTML, CSS, and
common/ are not formatted.

  --check  Write nothing. Exit 1 when a file is not formatted.

oxfmt comes from apps/cli's devDependencies; run
"node common/scripts/install-run-rush.js install" first.
`

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}
const unknown = args.filter(arg => arg !== '--check')
if (unknown.length) {
  process.stderr.write(`format: unknown argument ${unknown[0]}\n\n${HELP}`)
  process.exit(2)
}
const check = args.includes('--check')

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const CODE = /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/
const FIXTURES = /(?:^|\/)fixtures\//

const listed = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages', 'scripts'],
  { cwd: root, encoding: 'utf8' },
)
const files = [...new Set(listed.split('\0'))]
  .filter(path => CODE.test(path) && !FIXTURES.test(path) && existsSync(join(root, path)))
  .toSorted((a, b) => a.localeCompare(b))

let bin
try {
  const require = createRequire(join(root, 'apps/cli/package.json'))
  bin = join(dirname(require.resolve('oxfmt/package.json')), 'bin/oxfmt')
} catch {
  process.stderr.write('format: oxfmt is not installed. Run "node common/scripts/install-run-rush.js install".\n')
  process.exit(1)
}

const result = spawnSync(process.execPath, [bin, '-c', '.oxfmtrc.json', check ? '--check' : '--write', ...files], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) {
  throw result.error
}
if (result.status !== 0 && check) {
  process.stderr.write('format: run "node scripts/format.mjs" to format these files.\n')
}
process.exit(result.status ?? 1)
