import process from 'node:process'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import pkg from '../../package.json' with { type: 'json' }

/**
 * As on a system whose user has no home directory to resolve: there `os.homedir()` throws, and so does
 * `homeDir()`, which is that function. Commands that need no session must still run.
 */
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: () => {
      throw Object.assign(new Error('ENOENT: no such file or directory, uv_os_homedir'), { code: 'ENOENT' })
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

function capture(): () => string {
  const out: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    out.push(String(chunk))
    return true
  })
  return () => out.join('')
}

describe('a system that cannot resolve a home directory', () => {
  it('prints the version and the help', async () => {
    // Imported inside the test: a module load that needs a home directory fails this test, not the whole file.
    const { runCli } = await import('./app.ts')
    const stdout = capture()
    expect(await runCli(['--version'])).toBe(0)
    expect(stdout()).toBe(`estela ${pkg.version}\n`)
    expect(await runCli(['--help'])).toBe(0)
    expect(stdout()).toContain('Usage:')
  })
})
