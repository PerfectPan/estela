import { dirname } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { x } from 'tinyexec'

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Builds the plugin once before all tests with `NODE_ENV=production` so artifact tests never race
 * on `dist/` and always inspect a fresh production build.
 */
export default async function setup(): Promise<void> {
  const proc = await x('pnpm', ['run', 'build'], {
    nodeOptions: {
      cwd: pluginDir,
      env: { ...process.env, NODE_ENV: 'production' },
    },
    nodePath: false,
    throwOnError: false,
  })
  if (proc.exitCode !== 0) {
    throw new Error(
      `dsh-plugin build failed (exit ${proc.exitCode}):\n${proc.stdout.slice(-4000)}${proc.stderr.slice(-4000)}`,
    )
  }
}
