import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface Installed {
  tarball: string
  /** Bytes of the `.tgz`. */
  tarballBytes: number
  /** Paths inside the tarball, as `npm pack` lists them. */
  files: string[]
  /** Empty project the tarball is installed into. */
  installDir: string
  /** `node_modules/.bin/agent-trace` inside `installDir`. */
  bin: string
}

/** `npm pack` in `apps/cli`, then `npm install <tarball>` into an empty directory under `root`. */
export async function packAndInstall(root: string, repo: string): Promise<Installed> {
  const cliDir = join(repo, 'apps/cli')
  if (!existsSync(join(cliDir, 'dist/cli.mjs')) || !existsSync(join(cliDir, 'dist/bin.mjs')))
    throw new Error('apps/cli/dist is missing. Run `node common/scripts/install-run-rush.js build --to @rivus/agent-trace` first.')
  const { stdout } = await exec('npm', ['pack', '--json', '--pack-destination', root], { cwd: cliDir })
  const [packed] = JSON.parse(stdout) as { filename: string, size: number, files: { path: string }[] }[]
  if (!packed)
    throw new Error(`npm pack printed no package: ${stdout}`)
  const tarball = join(root, packed.filename)
  const installDir = join(root, 'install')
  await mkdir(installDir, { recursive: true })
  await writeFile(join(installDir, 'package.json'), `${JSON.stringify({ name: 'agent-trace-smoke', private: true })}\n`)
  await exec('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', tarball], { cwd: installDir })
  return {
    tarball,
    tarballBytes: packed.size,
    files: packed.files.map(file => file.path).toSorted(),
    installDir,
    bin: join(installDir, 'node_modules/.bin/agent-trace'),
  }
}
