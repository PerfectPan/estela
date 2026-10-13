#!/usr/bin/env node
// The one launcher. From source (`node bin.mjs`) it loads `src/main.ts`; `vp pack` builds it into
// `dist/bin.mjs` with `AGENT_TRACE_BUNDLE` defined, where it loads `./cli.mjs`. Only the version
// check is imported statically: Node 20 must reach it before any `.ts` file or `node:sqlite` loads.
import { unsupportedNodeMessage } from './src/node-version.mjs'

const message = unsupportedNodeMessage(process.versions.node)
if (message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

await import('@rivus/agent-trace-runtime-node/sqlite-warning')
const { main } = typeof AGENT_TRACE_BUNDLE !== 'undefined' ? await import('./cli.mjs') : await import('./src/main.ts')
main().catch(error => {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`${text}\n`)
  process.exit(1)
})
