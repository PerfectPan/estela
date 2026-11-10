import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import {
  DSH_TRACE_PLUGIN_MARKER,
  installDshTracePlugin,
  resolveDshTracePluginPaths,
  uninstallDshTracePlugin,
} from '../src/dsh-plugin.ts'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-trace-dsh-plugin-'))
}

function pathsOf(home: string) {
  return resolveDshTracePluginPaths({
    DSH_HOME: home,
    DSH_AGENT_TRACE_PLUGIN_FILE: join(home, 'plugins', 'agent-trace-dsh.mjs'),
    DSH_AGENT_TRACE_PATCH_FILE: join(home, 'cordis.patch.yml'),
    DSH_AGENT_TRACE_DIR: join(home, 'agent-trace'),
  })
}

describe('dsh-plugin install and uninstall', () => {
  it('preserves linked configuration and plugin files without changing their targets', async () => {
    const home = await tempHome()
    const paths = pathsOf(home)
    const target = join(home, 'dotfiles.yml')
    await writeFile(target, '[]\n')
    await symlink(target, paths.patchPath)
    try {
      await expect(installDshTracePlugin(paths)).rejects.toThrow('symbolic link')
      await expect(uninstallDshTracePlugin(paths)).rejects.toThrow('symbolic link')
      expect((await lstat(paths.patchPath)).isSymbolicLink()).toBe(true)
      expect(await readFile(target, 'utf8')).toBe('[]\n')
      await rm(paths.patchPath)
      await mkdir(join(home, 'plugins'))
      await symlink(target, paths.pluginPath)
      await expect(installDshTracePlugin(paths)).rejects.toThrow('symbolic link')
      expect((await lstat(paths.pluginPath)).isSymbolicLink()).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('refuses malformed registration before changing either managed file', async () => {
    const home = await tempHome()
    const paths = pathsOf(home)
    try {
      await installDshTracePlugin(paths)
      const plugin = await readFile(paths.pluginPath, 'utf8')
      const broken = '# agent-trace-dsh-plugin:start\nforeign: true\n'
      await writeFile(paths.patchPath, broken)
      await expect(installDshTracePlugin(paths)).rejects.toThrow('invalid agent-trace plugin markers')
      await expect(uninstallDshTracePlugin(paths)).rejects.toThrow('invalid agent-trace plugin markers')
      expect(await readFile(paths.patchPath, 'utf8')).toBe(broken)
      expect(await readFile(paths.pluginPath, 'utf8')).toBe(plugin)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('propagates registration I/O failures rather than reporting success', async () => {
    const home = await tempHome()
    const paths = pathsOf(home)
    try {
      await mkdir(paths.patchPath)
      await expect(installDshTracePlugin(paths)).rejects.toThrow(/EISDIR/)
      await expect(readFile(paths.pluginPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('installs the plugin and the patch, and is idempotent', async () => {
    const home = await tempHome()
    const paths = pathsOf(home)
    const first = await installDshTracePlugin(paths)
    expect(first.status).toBe('installed')
    expect(first.patchUpdated).toBe(true)
    const body = await readFile(paths.pluginPath, 'utf8')
    expect(body).toContain(DSH_TRACE_PLUGIN_MARKER)
    expect(body).toContain(JSON.stringify(paths.tracesDir).slice(1, -1))
    const patch = await readFile(paths.patchPath, 'utf8')
    expect(patch).toContain('- insert:')
    const again = await installDshTracePlugin(paths)
    expect(again.status).toBe('installed')
    expect(await readFile(paths.patchPath, 'utf8')).toBe(patch)
    await rm(home, { recursive: true, force: true })
  })

  it('refuses to overwrite an unmanaged plugin file', async () => {
    const home = await tempHome()
    const paths = pathsOf(home)
    await mkdir(join(home, 'plugins'), { recursive: true })
    await writeFile(paths.pluginPath, '# someone else\n', { mode: 0o600 })
    await expect(installDshTracePlugin(paths)).rejects.toThrow('not managed by @rivus/agent-trace')
    // The stranger's file is intact, and no patch entry was written.
    expect(await readFile(paths.pluginPath, 'utf8')).toBe('# someone else\n')
    await expect(readFile(paths.patchPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await rm(home, { recursive: true, force: true })
  })

  it('uninstalls cleanly, leaves a foreign patch body, and skips when absent', async () => {
    const home = await tempHome()
    const paths = pathsOf(home)
    await writeFile(paths.patchPath, '- remove: foreign\n', { mode: 0o600 })
    await installDshTracePlugin(paths)
    const removed = await uninstallDshTracePlugin(paths)
    expect(removed.status).toBe('removed')
    const patch = await readFile(paths.patchPath, 'utf8')
    expect(patch).toBe('- remove: foreign\n')
    // A second uninstall skips the file it already removed.
    const skipped = await uninstallDshTracePlugin(paths)
    expect(skipped.status).toBe('skipped')
    await rm(home, { recursive: true, force: true })
  })
})
