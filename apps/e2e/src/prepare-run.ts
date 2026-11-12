import type { Installed } from './tarball.ts'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { packAndInstall } from './tarball.ts'

export const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')

export interface Run extends Installed {
  /** Temp directory for this run; removed afterwards unless the keep variable is `1`. */
  root: string
  /** Holds the fake `open` and `xdg-open`. */
  fakeBin: string
}

/** Records each URL the CLI opens instead of starting a browser (`open` on macOS, `xdg-open` on Linux). */
const OPENER = '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$ESTELA_SMOKE_OPEN_LOG"\n'

/**
 * The shared global setup of `test:smoke` and `test:e2e`: a temp root, the built, packed, and
 * installed tarball, the fake opener, then `extra(root)` (the synthetic homes). On failure the
 * root is removed and the error rethrown.
 */
export async function prepareRun<T>(
  name: string,
  keepVariable: string,
  extra: (root: string) => Promise<T>,
): Promise<{ context: Run & T; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), `estela-${name}-`))
  const cleanup = async () => {
    if (process.env[keepVariable] !== '1') {
      await rm(root, { recursive: true, force: true })
    }
  }
  try {
    const installed = await packAndInstall(root, repo)
    const fakeBin = join(root, 'fake-bin')
    await mkdir(fakeBin, { recursive: true })
    for (const opener of ['open', 'xdg-open']) {
      await writeFile(join(fakeBin, opener), OPENER)
      await chmod(join(fakeBin, opener), 0o755)
    }
    const more = await extra(root)
    process.stdout.write(
      `node: ${process.version}\ntarball: ${installed.tarball} (${installed.tarballBytes} bytes, ${installed.files.length} files)\n`,
    )
    return { context: { root, fakeBin, ...installed, ...more }, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
