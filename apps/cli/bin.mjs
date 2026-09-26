#!/usr/bin/env node
import { unsupportedNodeMessage } from './src/node-version.mjs'

const message = unsupportedNodeMessage(process.versions.node)
if (message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const { main } = await import('./src/main.ts')
main().catch((error) => {
  const text = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${text}\n`)
  process.exit(1)
})
