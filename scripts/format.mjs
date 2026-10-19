#!/usr/bin/env node
// Formats the repository's JS and TS code with `vp fmt` and the `fmt` block of the root vite.config.ts.
// vite-plus is resolved from apps/cli, like the other root scripts that need the workspace install.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const HELP = `Usage:
  node scripts/format.mjs [--check] [--help]

Formats the JS and TS files (.js .jsx .mjs .cjs .ts .tsx .mts .cts) that git
tracks or would track under apps/, packages/, and scripts/, plus the root
vite.config.ts, with "vp fmt" and the fmt block of the root vite.config.ts.
Fixtures are skipped; Markdown, JSON, HTML, and CSS are not formatted.

  --check  Write nothing. Exit 1 when a file is not formatted.

vite-plus comes from apps/cli's devDependencies; run "pnpm install" first.
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

const SCOPE = ['apps', 'packages', 'scripts', 'vite.config.ts']
const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...SCOPE], {
  cwd: root,
  encoding: 'utf8',
})
const files = [...new Set(listed.split('\0'))]
  .filter(path => CODE.test(path) && !FIXTURES.test(path) && existsSync(join(root, path)))
  .toSorted((a, b) => a.localeCompare(b))

let bin
try {
  const require = createRequire(join(root, 'apps/cli/package.json'))
  bin = join(dirname(require.resolve('vite-plus/package.json')), 'bin/vp')
} catch {
  process.stderr.write('format: vite-plus is not installed. Run "pnpm install".\n')
  process.exit(1)
}

const result = spawnSync(process.execPath, [bin, 'fmt', check ? '--check' : '--write', ...files], {
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
