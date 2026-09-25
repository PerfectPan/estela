import type { E2eHomes } from './homes.ts'
import type { Installed } from '../tarball.ts'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { packAndInstall } from '../tarball.ts'
import { buildE2eHomes } from './homes.ts'

export interface E2eContext extends Installed {
  /** Temp directory for this run; removed afterwards unless `AGENT_TRACE_E2E_KEEP=1`. */
  root: string
  repo: string
  /** Holds the fake `open` and `xdg-open`. */
  fakeBin: string
  homes: E2eHomes
}

/** Where the context travels to the test workers: Playwright passes the environment on. */
export const CONTEXT_ENV = 'AGENT_TRACE_E2E_CONTEXT'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** Records each URL the CLI opens instead of starting a browser (`open` on macOS, `xdg-open` on Linux). */
const OPENER = '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$AGENT_TRACE_SMOKE_OPEN_LOG"\n'

/** Packs and installs the tarball once, and builds the synthetic homes (plan 5.2). */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const root = await mkdtemp(join(tmpdir(), 'agent-trace-e2e-'))
  const cleanup = async () => {
    if (process.env.AGENT_TRACE_E2E_KEEP !== '1')
      await rm(root, { recursive: true, force: true })
  }
  try {
    const installed = await packAndInstall(root, repo)
    const homes = await buildE2eHomes(root, repo)
    const fakeBin = join(root, 'fake-bin')
    await mkdir(fakeBin, { recursive: true })
    for (const name of ['open', 'xdg-open']) {
      await writeFile(join(fakeBin, name), OPENER)
      await chmod(join(fakeBin, name), 0o755)
    }
    const context: E2eContext = { root, repo, fakeBin, homes, ...installed }
    process.env[CONTEXT_ENV] = JSON.stringify(context)
    process.stdout.write(`node: ${process.version}\ntarball: ${installed.tarball} (${installed.tarballBytes} bytes)\n`)
  }
  catch (error) {
    await cleanup()
    throw error
  }
  return cleanup
}
