import type { Browser, BrowserContext, Page } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import type { Frame } from './demo-stage.ts'
import { execFile, spawn } from 'node:child_process'
import { mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { chromium } from '@playwright/test'
import { buildDemoHome } from './demo-home.ts'
import { Stage, startCapture } from './demo-stage.ts'

const HELP = `Usage:
  node apps/e2e/src/demo/record-demo.ts [--out <dir>] [--work <dir>] [--no-video] [--no-shots] [--no-captions]

Builds the synthetic demo home (demo-home.ts), starts the built CLI (apps/cli/dist/bin.mjs; run
pnpm build first) with HOME pointed at it, and drives the real UI with Playwright:

  screenshots   <out>/{browser,workspace}-{dark,light}.png       1440x900 at 2x
                <out>/{browser,workspace}-{dark,light}-16x9.webp  1600x900 at 2x (DevFrame showcase)
                <out>/readme-workspace-dark.png                   1600x900
  video         <out>/estela-demo.mp4 (H.264, yuv420p, faststart), .webm (VP9),
                <out>/estela-demo-loop.webp and .gif (about 12 s, 1200 px wide)

Needs ffmpeg, cwebp, and img2webp (libwebp) on PATH, and Playwright's Chromium (npx playwright install chromium) or
ESTELA_E2E_CHANNEL=chrome. Defaults: --out /tmp/estela-media, --work /tmp/estela-demo.
The work directory is deleted and rebuilt; it holds the home, frames, and the exported report.
`

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: '/tmp/estela-media' },
    work: { type: 'string', default: '/tmp/estela-demo' },
    'no-video': { type: 'boolean', default: false },
    'no-shots': { type: 'boolean', default: false },
    'no-captions': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})
if (values.help) {
  process.stdout.write(HELP)
  process.exit(0)
}

const exec = promisify(execFile)
const repo = resolve(fileURLToPath(import.meta.url), '../../../../..')
const out = resolve(values.out)
const work = resolve(values.work)
/** The browser's clock, so relative dates ("yesterday") come out the same on every run. */
const NOW = new Date('2026-11-13T10:30:00Z')
const DEMO_TITLE = 'Add cursor pagination to /books'
const MARKER = '.estela-demo-work'

/** Starts the CLI on a free port with only the synthetic home visible; resolves with its URL. */
async function startCli(home: string, cwd: string): Promise<{ base: string; child: ChildProcess }> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  // Agent home overrides would point the viewer at real sessions.
  for (const name of Object.keys(env)) {
    if (
      /^(ESTELA_|CLAUDE_CONFIG_DIR$|CODEX_HOME$|DSH_HOME$|GROK_HOME$|GEMINI_CLI_HOME$|PI_CODING_AGENT_DIR$|XDG_)/.test(
        name,
      )
    ) {
      delete env[name]
    }
  }
  env.HOME = home
  env.XDG_CACHE_HOME = join(work, 'cache')
  const child = spawn(
    process.execPath,
    [join(repo, 'apps/cli/dist/bin.mjs'), '--no-auth', '--no-open', '--port', '0'],
    {
      cwd,
      env,
    },
  )
  let output = ''
  const ready = new Promise<string>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`the CLI did not start:\n${output}`)), 30_000)
    const read = (chunk: Buffer) => {
      output += chunk.toString()
      const match = /Ready: (http:\/\/localhost:\d+\/__estela\/)/.exec(output)
      if (match) {
        clearTimeout(timer)
        done(match[1]!)
      }
    }
    child.stdout!.on('data', read)
    child.stderr!.on('data', read)
    child.on('exit', code => fail(new Error(`the CLI exited with ${code}:\n${output}`)))
  })
  try {
    return { base: await ready, child }
  } catch (error) {
    child.kill()
    throw error
  }
}

async function newPage(
  browser: Browser,
  options: { width: number; height: number; scale: number; dark: boolean },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: options.scale,
    colorScheme: options.dark ? 'dark' : 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
  })
  await context.clock.setFixedTime(NOW)
  return { context, page: await context.newPage() }
}

async function ffmpeg(args: string[]): Promise<void> {
  await exec('ffmpeg', ['-y', '-loglevel', 'error', ...args], { maxBuffer: 16 * 1024 * 1024 })
}

/** A point on the timeline just right of the compaction rule: the first request after it. */
async function afterCompaction(page: Page): Promise<{ x: number; y: number }> {
  const rule = (await page.locator('rect[data-marker=compaction]').first().boundingBox())!
  const bar = page.locator('rect[data-marker=request]')
  const xs = await bar.evaluateAll(rects => rects.map(rect => rect.getBoundingClientRect()))
  const next = xs.filter(box => box.x > rule.x + rule.width / 2).toSorted((a, b) => a.x - b.x)[0]!
  return { x: next.x + next.width / 2, y: next.y + next.height - 4 }
}

async function clickAfterCompaction(page: Page): Promise<void> {
  const point = await afterCompaction(page)
  await page.mouse.click(point.x, point.y)
}

/** The session browser with the demo session selected in the preview pane. */
async function showBrowser(page: Page, base: string): Promise<void> {
  await page.goto(base)
  const row = page.locator('[data-trace-id]').filter({ hasText: DEMO_TITLE })
  await row.waitFor()
  await row.click()
  await page.getByRole('button', { name: /Open session/ }).waitFor()
  await page.mouse.move(-10, -10)
}

/** The demo workspace with the first request after the compaction in "Model saw". */
async function showWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Open session/ }).click()
  await page.getByTestId('ledger').waitFor()
  await clickAfterCompaction(page)
  await page.getByRole('tab', { name: 'Model saw' }).click()
  await page.getByTestId('model-saw').waitFor()
  await page.mouse.move(-10, -10)
  await page.waitForTimeout(400)
}

async function screenshots(browser: Browser, base: string): Promise<string[]> {
  const written: string[] = []
  for (const dark of [true, false]) {
    const theme = dark ? 'dark' : 'light'
    for (const [suffix, width] of [
      ['', 1440],
      ['-16x9', 1600],
    ] as const) {
      const { context, page } = await newPage(browser, { width, height: 900, scale: 2, dark })
      await showBrowser(page, base)
      const browserPng = join(work, `browser-${theme}${suffix}.png`)
      await page.screenshot({ path: browserPng })
      await showWorkspace(page)
      const workspacePng = join(work, `workspace-${theme}${suffix}.png`)
      await page.screenshot({ path: workspacePng })
      await context.close()
      for (const png of [browserPng, workspacePng]) {
        const name = png.slice(work.length + 1)
        if (suffix) {
          const webp = join(out, name.replace('.png', '.webp'))
          await exec('cwebp', ['-quiet', '-q', '88', '-m', '6', png, '-o', webp])
          written.push(webp)
        } else {
          await ffmpeg(['-i', png, join(out, name)])
          written.push(join(out, name))
        }
      }
      if (dark && suffix) {
        const readme = join(out, 'readme-workspace-dark.png')
        await ffmpeg(['-i', workspacePng, '-vf', 'scale=1600:-1:flags=lanczos', readme])
        written.push(readme)
      }
    }
  }
  return written
}

/** The walkthrough: browser → filter and search → open → timeline → Model saw → cost → dropped → compare → subagent → export. */
async function walkthrough(page: Page, stage: Stage, base: string): Promise<void> {
  await page.goto(base)
  await page.locator('[data-trace-id]').filter({ hasText: DEMO_TITLE }).waitFor()
  await page.waitForTimeout(500)
  await stage.place()
  await stage.caption('Every agent session on this machine')
  await stage.hold(1800)
  await stage.moveTo(260, 330, 900)
  await stage.hold(400)

  await stage.caption('Filter and search')
  await stage.click(page.getByText('Has compaction', { exact: true }), 800)
  await stage.hold(500)
  await stage.click(page.getByPlaceholder('Search titles and prompts'), 800, { x: 0.25, y: 0.5 })
  await stage.type('pagination')
  await stage.hold(700)
  await stage.click(page.locator('[data-trace-id]').filter({ hasText: DEMO_TITLE }), 700, { x: 0.3, y: 0.5 })
  await stage.hold(900)

  await stage.caption('Open a session')
  await stage.click(page.getByRole('button', { name: /Open session/ }), 800)
  await page.getByTestId('ledger').waitFor()
  await stage.hold(900)

  await stage.caption('Context per request — and the compaction that cut it')
  await stage.moveToLocator(page.locator('rect[data-marker=compaction]').first(), 900, { x: 0.5, y: 0.35 })
  await stage.hold(1600)

  await stage.caption('Model saw: what this request’s context held')
  const point = await afterCompaction(page)
  await stage.moveTo(point.x, point.y, 700)
  await stage.click()
  await stage.hold(500)
  await stage.click(page.getByRole('tab', { name: 'Model saw' }), 800)
  await page.getByTestId('model-saw').waitFor()
  await stage.hold(2200)

  await stage.caption('Recorded tokens at list price — never an estimate')
  await stage.moveToLocator(page.getByTestId('request-cost'), 700, { x: 0.3, y: 0.5 })
  await stage.hold(1900)

  await stage.caption('The events the compaction removed')
  const saw = page.getByTestId('model-saw')
  await stage.moveToLocator(saw, 600, { x: 0.5, y: 0.6 })
  await stage.wheel(420, 900)
  await stage.hold(2000)

  await stage.caption('Compare: what changed since before the compaction')
  await stage.click(page.getByRole('tab', { name: 'Compare' }), 800)
  await page.getByTestId('context-compare').waitFor()
  await stage.hold(600)
  await stage.click(page.getByTestId('compare-before-compaction'), 800)
  await stage.hold(2400)

  await stage.caption('Subagent lanes — what the log did not record is “unavailable”')
  await stage.click(page.getByTestId('layout-lanes'), 900)
  await stage.hold(400)
  await page.getByTestId('ledger').focus()
  await page.keyboard.press('Home')
  await stage.hold(300)
  await stage.click(page.locator('[data-row-type=lane]').first(), 800, { x: 0.12, y: 0.5 })
  await stage.hold(500)
  const subRequest = page
    .locator('[role=option]')
    .filter({ hasText: 'REQUEST' })
    .filter({ hasText: 'claude-haiku' })
    .first()
  await stage.click(subRequest, 800, { x: 0.3, y: 0.5 })
  await stage.hold(300)
  await stage.click(page.getByRole('tab', { name: 'Model saw' }), 700)
  await stage.hold(2400)

  await stage.caption('Export a redacted, single-file report')
  await stage.click(page.getByTestId('export-report'), 900)
  await page.getByTestId('export-dialog').waitFor()
  await stage.hold(900)
  await stage.click(page.getByTestId('export-confirm'), 600)
  await page.getByTestId('export-written').waitFor({ timeout: 30_000 })
  await stage.hold(2200)
  await stage.caption(null)
  await stage.hold(600)
}

/** Frames with their own timestamps → an ffconcat list → constant 60 fps outputs. */
async function encode(frames: Frame[], dir: string): Promise<{ seconds: number; files: string[] }> {
  const lines = ['ffconcat version 1.0']
  for (let index = 0; index < frames.length - 1; index++) {
    const duration = Math.max(0.001, frames[index + 1]!.at - frames[index]!.at)
    lines.push(`file '${frames[index]!.file}'`, `duration ${duration.toFixed(4)}`)
  }
  lines.push(`file '${frames.at(-2)!.file}'`)
  const list = join(dir, 'frames.ffconcat')
  await writeFile(list, `${lines.join('\n')}\n`)
  const seconds = frames.at(-1)!.at - frames[0]!.at
  const mp4 = join(out, 'estela-demo.mp4')
  const webm = join(out, 'estela-demo.webm')
  const input = ['-f', 'concat', '-safe', '0', '-i', list]
  await ffmpeg([
    ...input,
    '-vf',
    'fps=60,scale=1920:1080:flags=lanczos:out_range=tv,format=yuv420p',
    '-color_range',
    'tv',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '18',
    '-movflags',
    '+faststart',
    '-an',
    mp4,
  ])
  await ffmpeg(['-i', mp4, '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-an', webm])
  // The loop: the workspace beats (timeline, Model saw, dropped events), about 12 s.
  const loopFrom = Math.max(0, seconds * 0.3).toFixed(2)
  const webp = join(out, 'estela-demo-loop.webp')
  const gif = join(out, 'estela-demo-loop.gif')
  // ffmpeg builds often lack libwebp: PNG frames, then libwebp's img2webp.
  const loopFrames = join(dir, 'loop')
  await mkdir(loopFrames, { recursive: true })
  await ffmpeg([
    '-ss',
    loopFrom,
    '-t',
    '12',
    '-i',
    mp4,
    '-vf',
    'fps=15,scale=1200:-1:flags=lanczos',
    join(loopFrames, 'l%04d.png'),
  ])
  const pngs = (await readdir(loopFrames)).toSorted().map(name => join(loopFrames, name))
  await exec('img2webp', ['-loop', '0', '-lossy', '-q', '80', '-m', '4', '-d', '67', ...pngs, '-o', webp], {
    maxBuffer: 16 * 1024 * 1024,
  })
  await ffmpeg([
    '-ss',
    loopFrom,
    '-t',
    '12',
    '-i',
    mp4,
    '-vf',
    'fps=12,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-loop',
    '0',
    gif,
  ])
  return { seconds, files: [mp4, webm, webp, gif] }
}

async function main(): Promise<void> {
  // Only a directory this script made (it holds the marker) or an empty one is cleared.
  const existing = await readdir(work).catch((error: NodeJS.ErrnoException): string[] => {
    // Missing is fine; anything else (a file, no permission) stops before rm.
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  })
  if (existing.length > 0 && !existing.includes(MARKER)) {
    throw new Error(`${work} is not a work directory of this script; pass a new or empty --work`)
  }
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  await writeFile(join(work, MARKER), '')
  await mkdir(out, { recursive: true })
  // The real path (macOS: /tmp is /private/tmp), so HOME matches the paths the server sees.
  const demoHome = await buildDemoHome(join(await realpath(work), 'home'))
  // "Export report" writes into the server's working directory: the demo project.
  const project = join(demoHome.home, 'work/tinyshelf')
  await mkdir(project, { recursive: true })
  const { base, child } = await startCli(demoHome.home, project)
  const channel = process.env.ESTELA_E2E_CHANNEL
  const written: string[] = []
  let browser: Browser | undefined
  try {
    browser = await chromium.launch(channel ? { channel } : {})
    if (!values['no-shots']) {
      written.push(...(await screenshots(browser, base)))
    }
    if (!values['no-video']) {
      // The UI at its designed density, 1440x810, scaled to 1920x1080 by ffmpeg: a screencast
      // sends frames in CSS pixels whatever the device scale factor, and CSS zoom would break the
      // timeline's pointer math.
      const { context, page } = await newPage(browser, { width: 1440, height: 810, scale: 1, dark: true })
      await Stage.install(page)
      const stage = new Stage(page, { captions: !values['no-captions'], start: { x: 720, y: 520 } })
      const frames = join(work, 'frames')
      const capture = await startCapture(page, frames, { width: 1440, height: 810 })
      await walkthrough(page, stage, base)
      const recorded = await capture.stop()
      await context.close()
      const video = await encode(recorded, work)
      written.push(...video.files)
      process.stdout.write(`video: ${video.seconds.toFixed(1)} s from ${recorded.length} frames\n`)
    }
  } finally {
    child.kill()
    await browser?.close()
  }
  for (const file of written) {
    process.stdout.write(`${file}  ${((await stat(file)).size / 1024).toFixed(0)} KB\n`)
  }
  process.stdout.write(`work files: ${(await readdir(work)).join(', ')}\n`)
}

await main()
