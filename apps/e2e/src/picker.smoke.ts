import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { spawn as spawnPty } from 'node-pty'
import { describe, expect, inject, it } from 'vitest'
import { openedUrls, openLogPath, readyUrl, smokeEnv, start, waitFor } from './cli-process.ts'

const ctx = inject('smoke')

const OSC8 = '\u001B]8;;'
const ST = '\u001B\\'

/** Terminal text without OSC 8 hyperlink markers (the link text stays) or other escape sequences. */
function visibleText(raw: string): string {
  let text = ''
  let at = 0
  for (let open = raw.indexOf(OSC8); open !== -1; open = raw.indexOf(OSC8, at)) {
    const end = raw.indexOf(ST, open + OSC8.length)
    if (end === -1)
      break
    text += raw.slice(at, open)
    at = end + ST.length
  }
  return stripVTControlCharacters(text + raw.slice(at))
}

/** The three lines of clack's Ready box (top border, URL, bottom border), once drawn. */
function readyBox(raw: string): string[] {
  const lines = visibleText(raw).split(/\r?\n/)
  const top = lines.findIndex(line => line.includes('┌─Ready'))
  return top === -1 ? [] : lines.slice(top, top + 3).filter(line => line.length > 0)
}

/** The ref the CLI gives a session path, read from its plain `Ready:` line. */
async function refOf(path: string): Promise<string> {
  const server = start(process.execPath, [ctx.bin, path, '--no-open', '--port', '0'], { cwd: ctx.installDir, env: smokeEnv(ctx, openLogPath(ctx, 's16-ref')) })
  try {
    await waitFor('the Ready line', () => readyUrl(server.output().stdout) !== undefined)
    return readyUrl(server.output().stdout)!.ref
  }
  finally {
    await server.stop()
  }
}

describe('installed tarball in a terminal', () => {
  it('S16: --pick, type part of a title, Enter opens that session', async () => {
    const subagent = join(ctx.home, '.claude/projects/app-subagent/session.jsonl')
    const expected = await refOf(subagent)
    const log = openLogPath(ctx, 's16')
    const env = smokeEnv(ctx, log)
    env.TERM = 'xterm-256color'
    const term = spawnPty(process.execPath, [ctx.bin, '--pick', '--port', '0'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: ctx.installDir,
      env: env as Record<string, string>,
    })
    let screen = ''
    term.onData((data) => {
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
      await waitFor('the browser opener', () => openedUrls(log).length > 0)
      const ready = readyUrl(screen)
      expect(ready, visible()).toBeDefined()
      expect(ready!.ref).toBe(expected)
      const [opened] = openedUrls(log)
      expect(opened).toContain(`?s=${expected}#devframe_otp=`)
      expect(opened!.startsWith(ready!.base)).toBe(true)
      // The Ready box holds the one URL, as an OSC 8 link, and every box line has one width.
      await waitFor('the Ready box', () => readyBox(screen).length === 3)
      const box = readyBox(screen)
      expect(new Set(box.map(line => Array.from(line).length)).size, box.join('\n')).toBe(1)
      expect(box[1]).toContain(`${ready!.base}#/s/${expected}`)
      expect(screen).toContain(`\u001B]8;;${ready!.base}#/s/${expected}\u001B\\`)
      const text = visibleText(screen)
      expect(text.split(`${ready!.base}#/s/${expected}`)).toHaveLength(2)
    }
    finally {
      term.kill('SIGTERM')
      await exited
    }
  })
})
