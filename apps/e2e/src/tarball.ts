import { execFile } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import * as z from 'zod/mini'

const exec = promisify(execFile)

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** `execFile` failures carry `stdout` and `stderr` as own properties on the thrown `Error`. */
function execOutput(error: unknown): { stdout: string; stderr: string } {
  if (!(error instanceof Error) || !('stdout' in error) || !('stderr' in error)) {
    return { stdout: '', stderr: '' }
  }
  return { stdout: text(error.stdout), stderr: text(error.stderr) }
}

export interface Installed {
  tarball: string
  /** Bytes of the `.tgz`. */
  tarballBytes: number
  /** Paths inside the tarball, as `pnpm pack --json` lists them. */
  files: string[]
  /** Empty project the tarball is installed into. */
  installDir: string
  /** `node_modules/.bin/agent-trace` inside `installDir`. */
  bin: string
}

/**
 * Builds `@rivus/agent-trace` and the workspace packages it depends on, so the tarball never
 * holds a stale bundle.
 */
async function buildCli(repo: string): Promise<void> {
  try {
    await exec('pnpm', ['--filter', '@rivus/agent-trace...', 'run', 'build'], {
      cwd: repo,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (error) {
    const { stdout, stderr } = execOutput(error)
    throw new Error(
      `pnpm --filter '@rivus/agent-trace...' run build failed:\n${stdout.slice(-4000)}${stderr.slice(-4000)}`,
      {
        cause: error,
      },
    )
  }
}

/**
 * Build, `pnpm pack` in `apps/cli`, then `npm install <tarball>` into an empty directory under
 * `root`. pnpm pack, not npm pack: it rewrites the `workspace:` and `catalog:` specifiers into
 * real versions, which `npm install` of the tarball (and a registry publish) requires.
 */
export async function packAndInstall(root: string, repo: string): Promise<Installed> {
  await buildCli(repo)
  const cliDir = join(repo, 'apps/cli')
  const { stdout } = await exec('pnpm', ['pack', '--json', '--pack-destination', root], { cwd: cliDir })
  const packed = z.parse(
    z.object({ filename: z.string(), files: z.array(z.object({ path: z.string() })) }),
    JSON.parse(stdout),
  )
  const tarball = packed.filename
  if (!tarball) {
    throw new Error(`pnpm pack printed no package: ${stdout}`)
  }
  const { size } = await stat(tarball)
  const installDir = join(root, 'install')
  await mkdir(installDir, { recursive: true })
  await writeFile(join(installDir, 'package.json'), `${JSON.stringify({ name: 'agent-trace-smoke', private: true })}\n`)
  await exec('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', tarball], { cwd: installDir })
  return {
    tarball,
    tarballBytes: size,
    files: packed.files.map(file => file.path).toSorted(),
    installDir,
    bin: join(installDir, 'node_modules/.bin/agent-trace'),
  }
}
