import type { TestProject } from 'vitest/node'
import type { FixtureHome } from './fixture-home.ts'
import type { Installed } from './tarball.ts'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildFixtureHome } from './fixture-home.ts'
import { packAndInstall } from './tarball.ts'

export interface SmokeContext extends Installed, FixtureHome {
  /** Temp directory for this run; removed after the run unless `AGENT_TRACE_SMOKE_KEEP=1`. */
  root: string
  /** Holds the fake `open` and `xdg-open`. */
  fakeBin: string
}

declare module 'vitest' {
  export interface ProvidedContext {
    smoke: SmokeContext
  }
}

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Records each URL the CLI opens instead of starting a browser (`open` on macOS, `xdg-open` on Linux). */
const OPENER = '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$AGENT_TRACE_SMOKE_OPEN_LOG"\n'

async function prepare(root: string): Promise<SmokeContext> {
  const installed = await packAndInstall(root, repo)
  const fixtures = await buildFixtureHome(root, repo)
  const fakeBin = join(root, 'fake-bin')
  await mkdir(fakeBin, { recursive: true })
  for (const name of ['open', 'xdg-open']) {
    await writeFile(join(fakeBin, name), OPENER)
    await chmod(join(fakeBin, name), 0o755)
  }
  return { root, ...installed, ...fixtures, fakeBin }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const root = await mkdtemp(join(tmpdir(), 'agent-trace-smoke-'))
  const cleanup = async () => {
    if (process.env.AGENT_TRACE_SMOKE_KEEP !== '1')
      await rm(root, { recursive: true, force: true })
  }
  let context: SmokeContext
  try {
    context = await prepare(root)
  }
  catch (error) {
    await cleanup()
    throw error
  }
  process.stdout.write(`node: ${process.version}\n`)
  process.stdout.write(`tarball: ${context.tarball} (${context.tarballBytes} bytes, ${context.files.length} files)\n`)
  for (const file of context.files)
    process.stdout.write(`  ${file}\n`)
  project.provide('smoke', context)
  return cleanup
}
