#!/usr/bin/env node
// Writes the live demo: the CLI's `build` command renders the demo trace bundled with the CLI into one redacted
// index.html, which goes to dist/client/demo/ beside the prerendered pages. The fixture path is passed explicitly:
// with no path, `build` would read the session named by the CLI's default-session environment variable first. Runs after `vp build`, which empties
// dist/. The CLI is a devDependency, so `pnpm -r build` builds it first.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const CLI_PACKAGE = '@rivus/estela'

const siteRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cliRoot = dirname(createRequire(join(siteRoot, 'package.json')).resolve(`${CLI_PACKAGE}/package.json`))
const bin = join(cliRoot, 'dist/bin.mjs')
const fixture = join(cliRoot, 'dist/fixtures/demo.trace.json')
const outDir = join(siteRoot, 'dist/client/demo')

if (!existsSync(bin) || !existsSync(fixture)) {
  process.stderr.write(
    `build-demo: ${bin} or ${fixture} does not exist. Build the CLI first: pnpm --filter '@rivus/estela-site...' run build\n`,
  )
  process.exit(1)
}

execFileSync(process.execPath, [bin, 'build', fixture, '--out-dir', outDir], { stdio: 'inherit' })
if (!existsSync(join(outDir, 'index.html'))) {
  process.stderr.write(`build-demo: the CLI wrote no ${join(outDir, 'index.html')}\n`)
  process.exit(1)
}
