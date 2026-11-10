import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, inject, it } from 'vite-plus/test'
import { openLogPath, run, smokeEnv } from './cli-process.ts'

const ctx = inject('smoke')

it('rejects invalid dsh-plugin arguments without installing anything', async () => {
  const home = join(ctx.root, 'dsh-invalid')
  await mkdir(home)
  for (const args of [['uninstal'], ['install', 'extra'], ['--no-index'], ['--unknown']]) {
    const result = await run(process.execPath, [ctx.bin, 'dsh-plugin', ...args], {
      cwd: ctx.installDir,
      env: smokeEnv(ctx, openLogPath(ctx, 'dsh-invalid'), { DSH_HOME: home }),
    })
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('only install or uninstall')
    expect(await readdir(home)).toEqual([])
  }
})

it('installs and uninstalls the packed plugin and rejects unreadable registration', async () => {
  const home = join(ctx.root, 'dsh-install')
  await mkdir(home)
  const env = smokeEnv(ctx, openLogPath(ctx, 'dsh-install'), { DSH_HOME: home })
  const invoke = (action: string) =>
    run(process.execPath, [ctx.bin, 'dsh-plugin', action], { cwd: ctx.installDir, env })
  expect((await invoke('install')).code).toBe(0)
  expect(await readFile(join(home, 'plugins/agent-trace-dsh.mjs'), 'utf8')).toContain('ctx.on("agent/created"')
  expect((await invoke('uninstall')).code).toBe(0)
  expect(await readdir(join(home, 'plugins'))).toEqual([])
  await writeFile(join(home, 'cordis.patch.yml'), '# agent-trace-dsh-plugin:start\nforeign: true\n')
  const failed = await invoke('install')
  expect(failed.code).toBe(1)
  expect(failed.stderr).toContain('invalid agent-trace plugin markers')
  expect(await readFile(join(home, 'cordis.patch.yml'), 'utf8')).toContain('foreign: true')
})
