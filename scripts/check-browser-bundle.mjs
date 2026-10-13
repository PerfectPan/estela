#!/usr/bin/env node
// D5: bundle kernel and rpc for the web target, which keeps node:* out of them.
// @rslib/core is owned by apps/cli. This script resolves it from that package.
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

const HELP = `Usage:
  node scripts/check-browser-bundle.mjs [--help]

Bundles @rivus/agent-trace-kernel and @rivus/agent-trace-rpc with rslib
output.target "web". Fails when a node:* import is unresolved.
`

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(HELP)
  process.exit(0)
}

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(new URL('../apps/cli/package.json', import.meta.url))
const rslibEntry = require.resolve('@rslib/core')
const { createRslib } = await import(pathToFileURL(rslibEntry).href)

const outDir = await mkdtemp(join(tmpdir(), 'agent-trace-browser-'))
const rslib = await createRslib({
  cwd: root,
  config: {
    lib: [
      {
        id: 'browser',
        format: 'esm',
        bundle: true,
        dts: false,
        syntax: 'es2022',
      },
    ],
    source: {
      entry: {
        kernel: 'packages/kernel/src/index.ts',
        rpc: 'packages/rpc/src/index.ts',
      },
    },
    output: {
      target: 'web',
      distPath: { root: outDir },
      externals: [/^devframe($|\/)/],
      cleanDistPath: true,
    },
  },
})

try {
  const result = await rslib.build()
  await result.close()
  console.log(`check-browser-bundle: ok (${outDir})`)
} catch (error) {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(`check-browser-bundle: failed\n${text}`)
  process.exitCode = 1
} finally {
  await rm(outDir, { recursive: true, force: true })
}
