import type { TestProject } from 'vite-plus/test/node'
import type { FixtureHome } from './fixture-home.ts'
import type { Run } from './prepare-run.ts'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { buildFixtureHome } from './fixture-home.ts'
import { prepareRun, repo } from './prepare-run.ts'

export interface SmokeContext extends Run, FixtureHome {
  /** `XDG_CACHE_HOME` for the session index, inside the temp dir. */
  cache: string
}

declare module 'vite-plus/test' {
  export interface ProvidedContext {
    smoke: SmokeContext
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { context, cleanup } = await prepareRun('smoke', 'AGENT_TRACE_SMOKE_KEEP', async root => {
    const cache = join(root, 'cache')
    await mkdir(cache, { recursive: true })
    return { cache, ...(await buildFixtureHome(join(root, 'home'), repo)) }
  })
  for (const file of context.files) {
    process.stdout.write(`  ${file}\n`)
  }
  project.provide('smoke', context)
  return cleanup
}
