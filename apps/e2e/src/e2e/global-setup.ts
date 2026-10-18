import type { FixtureHome } from '../fixture-home.ts'
import type { Run } from '../prepare-run.ts'
import { join } from 'node:path'
import process from 'node:process'
import { buildFixtureHome } from '../fixture-home.ts'
import { prepareRun, repo } from '../prepare-run.ts'

export interface E2eContext extends Run {
  repo: string
  homes: {
    /** All three agents plus the browser suite's extra sessions. */
    main: FixtureHome
    /** The same without `~/.codex` (S3). */
    noCodex: FixtureHome
  }
}

/** Where the context travels to the test workers: Playwright passes the environment on. */
export const CONTEXT_ENV = 'AGENT_TRACE_E2E_CONTEXT'

/** Packs and installs the tarball once, and builds the synthetic homes. */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const { context, cleanup } = await prepareRun('e2e', 'AGENT_TRACE_E2E_KEEP', async root => ({
    repo,
    homes: {
      main: await buildFixtureHome(join(root, 'home'), repo, { browser: true }),
      noCodex: await buildFixtureHome(join(root, 'home-no-codex'), repo, { browser: true, codex: false }),
    },
  }))
  process.env[CONTEXT_ENV] = JSON.stringify(context satisfies E2eContext)
  return cleanup
}
