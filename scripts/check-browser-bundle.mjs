#!/usr/bin/env node
// D5: bundle kernel and rpc for the browser, which keeps node:* out of them.
// vite-plus is resolved from apps/cli, like the other root scripts that need a Rush-installed tool.
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

const HELP = `Usage:
  node scripts/check-browser-bundle.mjs [--help]

Bundles @rivus/agent-trace-kernel and @rivus/agent-trace-rpc with "vp pack"
(tsdown) for platform "browser". Fails when the bundle imports anything but
devframe, such as an unresolved node:* import, or when the bundler warns.
`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(new URL('../apps/cli/package.json', import.meta.url))
const vitePlusDir = dirname(require.resolve('vite-plus/package.json'))
// `vite-plus/pack` is import-only, so `require.resolve` cannot find it; its exports entry names the file.
const vitePlusExports = JSON.parse(readFileSync(join(vitePlusDir, 'package.json'), 'utf8')).exports
const { build } = await import(pathToFileURL(join(vitePlusDir, vitePlusExports['./pack'].import)).href)

const DEVFRAME = /^devframe($|\/)/
const outDir = await mkdtemp(join(tmpdir(), 'agent-trace-browser-'))
try {
  await build({
    config: false,
    cwd: root,
    entry: {
      kernel: 'packages/kernel/src/index.ts',
      rpc: 'packages/rpc/src/index.ts',
    },
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outDir,
    dts: false,
    report: false,
    logLevel: 'warn',
    failOnWarn: true,
    deps: { neverBundle: [DEVFRAME], onlyImport: [DEVFRAME] },
  })
  console.log(`check-browser-bundle: ok (${outDir})`)
} catch (error) {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(`check-browser-bundle: failed\n${text}`)
  process.exitCode = 1
} finally {
  await rm(outDir, { recursive: true, force: true })
}
