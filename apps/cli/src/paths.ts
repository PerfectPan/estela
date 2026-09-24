import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Built SPA from `@rivus/agent-trace-web`. */
export function webDistDir(): string {
  return join(here, '../../web/dist')
}

export function demoFixturePath(): string {
  return join(here, '../../../fixtures/demo.trace.json')
}
