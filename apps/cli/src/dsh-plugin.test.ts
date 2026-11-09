import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import {
  DSH_TRACE_PLUGIN_MARKER,
  buildDshTracePluginSource,
  installDshTracePlugin,
  resolveDshTracePluginPaths,
  uninstallDshTracePlugin,
  withDshTracePatch,
  withoutDshTracePatch,
} from './dsh-plugin.ts'

const START = '# agent-trace-dsh-plugin:start'
const END = '# agent-trace-dsh-plugin:end'

afterEach(async () => {
  // The tests write their own homes under a temp dir; nothing is left outside it.
})

describe('dsh-plugin patch merge', () => {
  it('appends its marker block to an empty patch and merges idempotently', () => {
    const once = withDshTracePatch('', '/opt/dsh-home/.dsh/plugins/agent-trace-dsh.mjs')
    expect(once).toContain(START)
    expect(once).toContain('name: /opt/dsh-home/.dsh/plugins/agent-trace-dsh.mjs')
    expect(once).toContain(END)
    const twice = withDshTracePatch(once, '/opt/dsh-home/.dsh/plugins/agent-trace-dsh.mjs')
    expect(twice).toBe(once)
    // A moved plugin file replaces its entry in place, and the foreign lines around it stay.
    const moved = withDshTracePatch('keep: me\n', '/elsewhere/agent-trace-dsh.mjs')
    expect(moved).toContain('keep: me')
    expect(moved).toContain('name: /elsewhere/agent-trace-dsh.mjs')
    expect(withDshTracePatch(moved, '/elsewhere/agent-trace-dsh.mjs')).toBe(moved)
  })

  it('repairs an orphaned start marker left by a crash mid-write', () => {
    const orphan = `${START}\n- insert:\n    - id: old\n`
    const merged = withDshTracePatch(orphan, '/opt/dsh-home/.dsh/plugins/agent-trace-dsh.mjs')
    expect(merged.match(new RegExp(START, 'g'))).toHaveLength(1)
    expect(merged.match(new RegExp(END, 'g'))).toHaveLength(1)
    expect(merged).toContain('agent-trace-dsh.mjs')
    expect(merged).not.toContain('id: old')
  })

  it('removes its block and nothing else, and empties to a deleted patch', () => {
    const body = 'before: 1\n\n' + withDshTracePatch('', '/p/agent-trace-dsh.mjs') + 'after: 2\n'
    const removed = withoutDshTracePatch(body)
    expect(removed).toContain('before: 1')
    expect(removed).toContain('after: 2')
    expect(removed).not.toContain(START)
    expect(removed).not.toContain('agent-trace-dsh.mjs')
    expect(withoutDshTracePatch(withDshTracePatch('', '/p/agent-trace-dsh.mjs'))).toBe('')
    // A body without the block passes through unchanged.
    expect(withoutDshTracePatch('keep: me\n')).toBe('keep: me\n')
  })
})

describe('dsh-plugin install and uninstall', () => {
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
    await writeFile(paths.patchPath, 'foreign: true\n', { mode: 0o600 })
    await installDshTracePlugin(paths)
    const removed = await uninstallDshTracePlugin(paths)
    expect(removed.status).toBe('removed')
    const patch = await readFile(paths.patchPath, 'utf8')
    expect(patch).toBe('foreign: true\n')
    // A second uninstall skips the file it already removed.
    const skipped = await uninstallDshTracePlugin(paths)
    expect(skipped.status).toBe('skipped')
    await rm(home, { recursive: true, force: true })
  })
})

describe('dsh-plugin source', () => {
  it('subscribes to the lifecycle events the traces need, and writes into the traces dir', () => {
    const source = buildDshTracePluginSource('/opt/dsh-home/.dsh/agent-trace')
    for (const event of [
      'agent/session-start',
      'agent/status',
      'session/event',
      'tools/result',
      'agent/turn-stopping',
      'agent/disposed',
      'session/disposed',
    ]) {
      expect(source).toContain(`ctx.on("${event}"`)
    }
    expect(source).toContain('assistant/message')
    expect(source).toContain('/opt/dsh-home/.dsh/agent-trace')
    // The plugin never lets a write failure break dsh: the record chain swallows its own errors.
    expect(source).toContain('() => {}')
  })
})
