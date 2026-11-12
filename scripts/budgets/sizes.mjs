// Sizes of the built artifacts: the web bundle, dist/cli.mjs, and the tarball `pnpm pack` writes.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

/**
 * The web bundle is the JS and CSS under `dist/web/assets/`, the code a browser downloads and parses.
 * Fonts are left out: they are already compressed and change only with a font update.
 */
function webBundle(cliDir) {
  const assets = join(cliDir, 'dist/web/assets')
  let raw = 0
  let gzip = 0
  for (const name of readdirSync(assets)) {
    if (!/\.(?:js|css)$/.test(name)) {
      continue
    }
    const bytes = readFileSync(join(assets, name))
    raw += bytes.length
    gzip += gzipSync(bytes).length
  }
  return { raw, gzip }
}

/** `pnpm pack`, not `npm pack`: it is how the release tarball is made (see docs/development/setup.md). */
function tarballBytes(cliDir, outDir) {
  const stdout = execFileSync('pnpm', ['pack', '--json', '--pack-destination', outDir], {
    cwd: cliDir,
    encoding: 'utf8',
  })
  const { filename } = JSON.parse(stdout)
  return statSync(filename).size
}

export function measureSizes(root, outDir) {
  const cliDir = join(root, 'apps/cli')
  const web = webBundle(cliDir)
  return {
    'web-raw': web.raw,
    'web-gzip': web.gzip,
    'cli-mjs': statSync(join(cliDir, 'dist/cli.mjs')).size,
    tarball: tarballBytes(cliDir, outDir),
  }
}
