import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import type { Browser, Page } from '@playwright/test'
import { DSH_VERSION } from '../src/contract/channel.ts'
import {
  createDshEnv,
  installDsh,
  launchChromium,
  packPlugin,
  ProcessTracker,
  runDshCli,
  startDshWeb,
} from '../test/dsh-harness.ts'
import { dismissNotices, openSidebarSession } from '../test/dsh-page.ts'
import { seedSession } from '../test/seed-session.mjs'

const exec = promisify(execFile)
const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)))
const DEFAULT_OUT = join(pluginDir, 'screenshots')
const DEMO_FIXTURE = join(pluginDir, 'test/fixtures/demo-session.v4.jsonl')
const MAX_WEBP_BYTES = 400 * 1024
const TARGET_DSH_VERSION = process.env.ESTELA_DSH_VERSION || DSH_VERSION

const HELP = `Usage:
  node apps/dsh-plugin/scripts/capture-screenshots.ts [--out <dir>] [--dsh-bin <path>]

Captures WebP screenshots (1440x900 @ 2x, <= 400 KB each) of @rivus/dsh-estela inside a temporary
isolated dsh web instance running the synthetic demo session (test/fixtures/demo-session.v4.jsonl).
Requires cwebp on PATH and Playwright Chromium (or ESTELA_E2E_CHANNEL=chrome).
`

async function writeThemePatch(dshHome: string, preference: 'light' | 'dark'): Promise<void> {
  await writeFile(
    join(dshHome, 'profiles/web/cordis.patch.yml'),
    [
      '- id: ui-settings-general',
      '  name: "@deepseek-ai/dsh-client-ui-settings-general"',
      '  config:',
      '    welcomeNoticeVersion: 2026-09-28.1',
      '- id: ui-theme',
      '  name: "@deepseek-ai/dsh-client-ui-theme"',
      '  config:',
      `    preference: ${preference}`,
      '- id: locale',
      '  name: "@deepseek-ai/dsh-client-locale"',
      '  config:',
      '    preference: en',
      '',
    ].join('\n'),
    'utf8',
  )
}

async function encodeWebpUnderLimit(pngPath: string, webpPath: string): Promise<number> {
  for (const quality of [88, 82, 76, 70, 62]) {
    await exec('cwebp', ['-quiet', '-q', String(quality), '-m', '6', pngPath, '-o', webpPath])
    const info = await stat(webpPath)
    if (info.size <= MAX_WEBP_BYTES) {
      return info.size
    }
  }
  const finalInfo = await stat(webpPath)
  throw new Error(`${webpPath} is ${finalInfo.size} bytes, over the ${MAX_WEBP_BYTES}-byte limit`)
}

async function clickFirstRequestAfterCompaction(page: Page): Promise<void> {
  const rule = await page.locator('estela-workspace rect[data-marker=compaction]').first().boundingBox()
  if (!rule) {
    throw new Error('compaction marker not found on timeline')
  }
  const boxes = await page
    .locator('estela-workspace rect[data-marker=request]')
    .evaluateAll(rects => rects.map(rect => rect.getBoundingClientRect()))
  const next = boxes.filter(box => box.x > rule.x + rule.width / 2).toSorted((a, b) => a.x - b.x)[0]
  if (!next) {
    throw new Error('no request bar found after compaction marker')
  }
  await page.mouse.click(next.x + next.width / 2, next.y + next.height - 4)
}

async function capturePngToWebp(
  page: Page,
  workDir: string,
  outDir: string,
  name: string,
): Promise<{ path: string; bytes: number }> {
  await page.mouse.move(10, 10)
  await page.waitForTimeout(350)
  const pngPath = join(workDir, `${name}.png`)
  const webpPath = join(outDir, `${name}.webp`)
  await page.screenshot({ path: pngPath })
  const bytes = await encodeWebpUnderLimit(pngPath, webpPath)
  return { path: webpPath, bytes }
}

async function openModelSawAfterCompaction(page: Page): Promise<void> {
  await clickFirstRequestAfterCompaction(page)
  await page.locator('estela-workspace [data-testid="inspector"] [role=tab]').filter({ hasText: 'Model saw' }).click()
  await page.locator('estela-workspace [data-testid="model-saw"]').waitFor({ state: 'visible', timeout: 10_000 })
}

async function openEstelaDemo(browser: Browser, url: string, sessionId: string, colorScheme: 'light' | 'dark') {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'en-US',
    colorScheme,
  })
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await dismissNotices(page)
  await openSidebarSession(page, sessionId, { selectEstela: true })
  await page
    .locator('estela-workspace rect[data-marker=compaction]')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 })
  return { ctx, page }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: DEFAULT_OUT },
      'dsh-bin': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(HELP)
    return
  }

  const outDir = resolve(values.out)
  await mkdir(outDir, { recursive: true })

  const tracker = new ProcessTracker()
  const rootTmp = await mkdtemp(join(tmpdir(), 'estela-dsh-shots-'))
  let browser: Browser | undefined

  try {
    const prefixDir = join(rootTmp, 'dsh-prefix')
    const npmHomeDir = join(rootTmp, 'npm-home')
    const packDir = join(rootTmp, 'pack')
    const dshHome = join(rootTmp, 'dsh-home')
    const rawFakeHome = join(rootTmp, 'fake-home')
    await Promise.all([mkdir(dshHome, { recursive: true }), mkdir(rawFakeHome, { recursive: true })])
    const fakeHome = realpathSync(rawFakeHome)
    const demoWorkspace = join(fakeHome, 'projects', 'http-retry')
    await mkdir(demoWorkspace, { recursive: true })
    const env = createDshEnv(dshHome, fakeHome)

    const [dshBin, tarball, launched] = await Promise.all([
      values['dsh-bin']
        ? Promise.resolve(resolve(values['dsh-bin']))
        : installDsh(prefixDir, TARGET_DSH_VERSION, npmHomeDir, tracker),
      packPlugin(packDir, npmHomeDir, tracker),
      launchChromium(),
    ])
    browser = launched

    const install = await runDshCli(dshBin, ['plugin', '--profile', 'web', 'add', tarball], env, tracker)
    if (install.exitCode !== 0) {
      throw new Error(`dsh plugin add failed (exit ${install.exitCode}):\n${install.stdout}${install.stderr}`)
    }

    const demoSession = seedSession({
      home: dshHome,
      cwd: demoWorkspace,
      fixturePath: DEMO_FIXTURE,
    })

    const results: Array<{ path: string; bytes: number }> = []

    // Light theme shots: overview (Model saw), Compare (before vs after compaction), failed tool call.
    await writeThemePatch(dshHome, 'light')
    const lightDsh = await startDshWeb(dshBin, env, tracker)
    try {
      const { ctx, page } = await openEstelaDemo(browser, lightDsh.url, demoSession.id, 'light')
      try {
        await openModelSawAfterCompaction(page)
        results.push(await capturePngToWebp(page, rootTmp, outDir, 'overview-light'))

        await page
          .locator('estela-workspace [data-testid="inspector"] [role=tab]')
          .filter({ hasText: 'Compare' })
          .click()
        await page
          .locator('estela-workspace [data-testid="context-compare"]')
          .waitFor({ state: 'visible', timeout: 10_000 })
        await page.locator('estela-workspace [data-testid="compare-before-compaction"]').click()
        await page.waitForTimeout(250)
        await page.evaluate(() => {
          const entered = document
            .querySelector('estela-workspace')
            ?.shadowRoot?.querySelector('[data-testid="compare-entered"]')
          entered?.scrollIntoView({ block: 'start' })
        })
        await page.waitForTimeout(250)
        results.push(await capturePngToWebp(page, rootTmp, outDir, 'compare-light'))

        await page
          .locator('estela-workspace button')
          .filter({ hasText: /^Failures/ })
          .first()
          .click()
        await page.waitForTimeout(250)
        const failureRow = page
          .locator('estela-workspace [data-testid="ledger"] [role=option]')
          .filter({ has: page.locator('[data-testid="failed-tool"]') })
          .first()
        await failureRow.click()
        await page
          .locator('estela-workspace [data-testid="inspector"] [role=tab]')
          .filter({ hasText: 'Output' })
          .click()
        await page.waitForTimeout(300)
        results.push(await capturePngToWebp(page, rootTmp, outDir, 'tool-failure-light'))
      } finally {
        await ctx.close()
      }
    } finally {
      await lightDsh.stop()
    }

    // Dark theme shot: same overview (Model saw after compaction) in dark mode.
    await writeThemePatch(dshHome, 'dark')
    const darkDsh = await startDshWeb(dshBin, env, tracker)
    try {
      const { ctx, page } = await openEstelaDemo(browser, darkDsh.url, demoSession.id, 'dark')
      try {
        await openModelSawAfterCompaction(page)
        results.push(await capturePngToWebp(page, rootTmp, outDir, 'overview-dark'))
      } finally {
        await ctx.close()
      }
    } finally {
      await darkDsh.stop()
    }

    for (const item of results) {
      process.stdout.write(`${item.path} (${(item.bytes / 1024).toFixed(1)} KB)\n`)
    }
  } finally {
    if (browser) {
      await browser.close()
    }
    await tracker.cleanupAll()
    await rm(rootTmp, { recursive: true, force: true })
  }
}

await main()
