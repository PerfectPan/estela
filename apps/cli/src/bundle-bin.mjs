#!/usr/bin/env node
// `dist/bin.mjs`, the package bin. Only the version check and the warning filter load before
// `cli.mjs`: a static import of the CLI would link `node:sqlite` before this check runs.
import '@rivus/agent-trace-runtime-node/sqlite-warning'
import { unsupportedNodeMessage } from './node-version.mjs'

const message = unsupportedNodeMessage(process.versions.node)
if (message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const { main } = await import('./cli.mjs')
main().catch((error) => {
  const text = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${text}\n`)
  process.exit(1)
})
