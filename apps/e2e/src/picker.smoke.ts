import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { spawn as spawnPty } from 'node-pty'
import { describe, expect, inject, it } from 'vite-plus/test'
import {
  fakeOpener,
  openArgs,
  openedUrls,
  openLogPath,
  openSeen,
  readyUrl,
  smokeEnv,
  start,
  waitFor,
} from './cli-process.ts'

const ctx = inject('smoke')

/** The three lines of clack's Ready box (top border, URL, bottom border), once drawn. */
function readyBox(raw: string): string[] {
  const lines = stripVTControlCharacters(raw).split(/\r?\n/)
  const top = lines.findIndex(line => line.includes('┌─Ready'))
  return top === -1 ? [] : lines.slice(top, top + 3).filter(line => line.length > 0)
}

/** The trace id the CLI gives a session path, read from its plain `Ready:` line. */
async function traceIdOf(path: string): Promise<string> {
  const server = start(ctx.node, [ctx.bin, path, '--no-open', '--port', '0'], {
    cwd: ctx.installDir,
    env: smokeEnv(ctx, openLogPath(ctx, 's16-trace-id')),
  })
  try {
    await waitFor('the Ready line', () => readyUrl(server.output().stdout) !== undefined)
    return readyUrl(server.output().stdout)!.traceId
  } finally {
    await server.stop()
  }
}

describe('installed tarball in a terminal', () => {
  it('S16: --pick, type part of a title, Enter opens that session', async () => {
    const subagent = join(ctx.home, '.claude/projects/app-subagent/session.jsonl')
    const expected = await traceIdOf(subagent)
    const log = openLogPath(ctx, 's16')
    const term = spawnPty(ctx.node, [ctx.bin, '--pick', '--port', '0', ...openArgs], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: ctx.installDir,
      env: smokeEnv(ctx, log),
    })
    let screen = ''
    term.onData(data => {
      screen += data
    })
    const exited = new Promise<void>(resolve => term.onExit(() => resolve()))
    const visible = () => stripVTControlCharacters(screen)
    try {
      await waitFor('the picker', () => visible().includes('Pick a session'))
      await waitFor('the session list', () => visible().includes('Ask the helper'))
      const typedAt = screen.length
      term.write('helper')
      // clack redraws only changed lines, so read its match count and the focused row.
      await waitFor('the filtered list', () => {
        const after = stripVTControlCharacters(screen.slice(typedAt))
        return /Search: helper\S* \(1 match\)/.test(after) && after.includes('● Ask the helper')
      })
      term.write('\r')
      await waitFor('the Ready box and the browser opener', () => readyUrl(screen) !== undefined && openSeen(log))
      const ready = readyUrl(screen)
      expect(ready!.traceId).toBe(expected)
      if (fakeOpener) {
        const [opened] = openedUrls(log)
        expect(opened).toContain(`?s=${expected}#devframe_otp=`)
        expect(opened!.startsWith(ready!.base)).toBe(true)
      }
      // The Ready box holds the one URL, as an OSC 8 link, and every box line has one width.
      await waitFor('the Ready box', () => readyBox(screen).length === 3)
      const box = readyBox(screen)
      expect(new Set(box.map(line => Array.from(line).length)).size, box.join('\n')).toBe(1)
      expect(box[1]).toContain(`${ready!.base}#/s/${expected}`)
      // node-pty passes `name` as TERM on POSIX only; without TERM on Windows the CLI prints a plain URL.
      if (process.platform !== 'win32') {
        expect(screen).toContain(`\u001B]8;;${ready!.base}#/s/${expected}\u001B\\`)
      }
      expect(visible().split(`${ready!.base}#/s/${expected}`)).toHaveLength(2)
    } finally {
      // node-pty rejects a signal name on Windows.
      if (process.platform === 'win32') {
        term.kill()
      } else {
        term.kill('SIGTERM')
      }
      await exited
    }
  })
})
