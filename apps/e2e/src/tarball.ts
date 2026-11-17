import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { x } from 'tinyexec'
import * as z from 'zod/mini'

export interface Installed {
  tarball: string
  /** Bytes of the `.tgz`. */
  tarballBytes: number
  /** Paths inside the tarball, as `pnpm pack --json` lists them. */
  files: string[]
  /** Empty project the tarball is installed into. */
  installDir: string
  /**
   * The installed CLI as a file `node` can run: `node_modules/.bin/estela` inside `installDir`,
   * except on Windows, where npm links bins as `.cmd`, `.ps1`, and shell shims, so this is the
   * package's own bin file there.
   */
  bin: string
  /** The repository's npm registry, for npm and npx calls, which do not read `pnpm-workspace.yaml`. */
  registry: string
}

/**
 * Runs a package manager command and returns its stdout; a non-zero exit throws with the tail of
 * both streams. tinyexec resolves Windows `.cmd` shims (npm, npx, a pnpm installed through npm),
 * which `execFile` cannot start without a shell.
 */
async function sh(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<string> {
  const result = await x(command, args, { nodeOptions: options, nodePath: false, throwOnError: false })
  if (result.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.exitCode}:\n${result.stdout.slice(-4000)}${result.stderr.slice(-4000)}`,
    )
  }
  return result.stdout
}

const installedManifest = z.object({ bin: z.object({ estela: z.string() }) })

/**
 * Build, `pnpm pack` in `apps/cli`, then `npm install <tarball>` into an empty directory under
 * `root`. pnpm pack, not npm pack: it rewrites the `workspace:` and `catalog:` specifiers into
 * real versions, which `npm install` of the tarball (and a registry publish) requires.
 */
export async function packAndInstall(root: string, repo: string): Promise<Installed> {
  // Builds `@rivus/estela` and the workspace packages it depends on, so the tarball never holds a stale bundle.
  await sh('pnpm', ['--filter', '@rivus/estela...', 'run', 'build'], {
    cwd: repo,
    // Vitest sets NODE_ENV=test; the published artifact must use the production build conditions.
    env: { ...process.env, NODE_ENV: 'production' },
  })
  const cliDir = join(repo, 'apps/cli')
  const stdout = await sh('pnpm', ['pack', '--json', '--pack-destination', root], { cwd: cliDir })
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
  await writeFile(join(installDir, 'package.json'), `${JSON.stringify({ name: 'estela-smoke', private: true })}\n`)
  const registry = (await sh('pnpm', ['config', 'get', 'registry'], { cwd: repo })).trim()
  await sh('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', '--registry', registry, tarball], {
    cwd: installDir,
  })
  const packageDir = join(installDir, 'node_modules/@rivus/estela')
  const manifest = z.parse(installedManifest, JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')))
  return {
    tarball,
    tarballBytes: size,
    files: packed.files.map(file => file.path).toSorted(),
    installDir,
    bin:
      process.platform === 'win32'
        ? join(packageDir, manifest.bin.estela)
        : join(installDir, 'node_modules/.bin/estela'),
    registry,
  }
}
