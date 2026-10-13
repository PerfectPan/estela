import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `true` in `dist/cli.mjs` (`define` in the pack config); undeclared when Node runs `src/` directly. */
declare const AGENT_TRACE_BUNDLE: true

const bundled = typeof AGENT_TRACE_BUNDLE !== 'undefined'
const here = dirname(fileURLToPath(import.meta.url))

/** Built SPA: `dist/web/` in the package, `apps/web/dist` in the workspace. */
export function webDistDir(): string {
  return bundled ? join(here, 'web') : join(here, '../../web/dist')
}

/** Default session for `build` and `mcp` when no path is given. */
export function demoFixturePath(): string {
  return bundled ? join(here, 'fixtures/demo.trace.json') : join(here, '../../../fixtures/demo.trace.json')
}
