import type { TestProject } from 'vitest/node'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { buildFixtureHome } from './fixture-home.ts'
import type { SmokeContext } from './smoke-context.ts'
import { packAndInstall } from './tarball.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Records each URL the CLI opens instead of starting a browser (`open` on macOS, `xdg-open` on Linux). */
const OPENER = '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$AGENT_TRACE_SMOKE_OPEN_LOG"\n'

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const root = await mkdtemp(join(tmpdir(), 'agent-trace-smoke-'))
  const installed = await packAndInstall(root, repo)
  const fixtures = await buildFixtureHome(root, repo)
  const fakeBin = join(root, 'fake-bin')
  await mkdir(fakeBin, { recursive: true })
  for (const name of ['open', 'xdg-open']) {
    await writeFile(join(fakeBin, name), OPENER)
    await chmod(join(fakeBin, name), 0o755)
  }
  process.stdout.write(`node: ${process.version}\n`)
  process.stdout.write(`tarball: ${installed.tarball} (${installed.tarballBytes} bytes, ${installed.files.length} files)\n`)
  for (const file of installed.files)
    process.stdout.write(`  ${file}\n`)
  const context: SmokeContext = { root, ...installed, ...fixtures, fakeBin }
  project.provide('smoke', context)
  return async () => {
    if (process.env.AGENT_TRACE_SMOKE_KEEP !== '1')
      await rm(root, { recursive: true, force: true })
  }
}
