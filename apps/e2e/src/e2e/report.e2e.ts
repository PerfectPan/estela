import { realpathSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'
import { activePanel, ctx, expect, generateTrace, openWorkspace, test } from './harness.ts'

const exec = promisify(execFile)

/** Every form of `home` a log may hold: literal, Claude's dash slug, Grok's `%2F`, without the leading `/`, and JSON-escaped. */
function homeForms(home: string): string[] {
  return [
    home,
    home.replaceAll(/[^A-Za-z0-9]/g, '-'),
    home
      .split('/')
      .map(segment => encodeURIComponent(segment))
      .join('%2F'),
    home.slice(1),
    home.replaceAll('/', '\\/'),
  ].map(form => form.toLowerCase())
}

/** The forms of the synthetic and the real home found in `text`, case-insensitive. */
function homesIn(text: string): string[] {
  const lower = text.toLowerCase()
  return [...homeForms(ctx.homes.main.home), ...homeForms(homedir())].filter(form => lower.includes(form))
}

test('S9: Export report writes a redacted report that opens from file:// without a server, in the export language', async ({
  page,
  launch,
}) => {
  const home = ctx.homes.main.home
  // Redaction off on the local server: the workspace shows the home path, the report never does.
  // The session names the home in a git diff header, relative to /, JSON-escaped, %2F-encoded, and in capitals.
  const server = await openWorkspace(page, launch, ctx.homes.main.claudeHomeCwd, { env: { ESTELA_REDACT: '0' } })
  await expect(page.locator('section').first()).toContainText(home)

  // Export in Chinese: the report opens in the language it was exported in.
  await page.getByTestId('language-switch').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await page.getByTestId('export-report').click()
  const dialog = page.getByTestId('export-dialog')
  await expect(dialog).toContainText('会话文本和文件内容仍保留在报告中')
  // A modal: Tab stays inside, Escape closes it without clearing anything behind it.
  for (let n = 0; n < 4; n++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.getByTestId('export-report').click()
  await page.getByTestId('export-confirm').click()
  const shown = (await dialog.getByTestId('export-path').innerText()).trim()
  expect(shown).toMatch(/estela-report-[0-9a-f]{8}-\d{8}-\d{6}\/index\.html$/)
  // The server's working directory is outside the synthetic home, so the path is absolute.
  expect(shown.startsWith(realpathSync(server.cwd))).toBe(true)
  await dialog.getByRole('button', { name: '关闭' }).click()

  const dir = shown.slice(0, -'/index.html'.length)
  expect(await readdir(dir)).toEqual(['index.html'])
  expect(homesIn(await readFile(shown, 'utf8'))).toEqual([])

  // A new page from disk, with no server behind it. The browser context itself is en-US.
  const report = await page.context().newPage()
  await report.goto(pathToFileURL(shown).href)
  await expect(report.getByTestId('ledger')).toBeVisible()
  await expect(report.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(report.getByTestId('report-banner')).toContainText('会话文本和文件内容仍保留')
  await expect(report.getByTestId('export-report')).toHaveCount(0)
  await expect(report.locator('section').first()).toContainText('~/work/app')
  await report.getByTestId('language-switch').click()
  await expect(report.locator('html')).toHaveAttribute('lang', 'en')
  await expect(report.getByTestId('report-banner')).toContainText('Session text and file contents remain')
  await report.locator('[data-row-type=event]').filter({ hasText: 'diff --git' }).click()
  await expect(activePanel(report)).toContainText('diff --git a~/work/app/src/a.ts b~/work/app/src/a.ts')
  await report.getByRole('tab', { name: 'Raw' }).click()
  await expect(activePanel(report)).toContainText('"type": "user"')
  await report.getByRole('tab', { name: 'Model saw' }).click()
  await expect(report.getByTestId('model-saw')).toBeVisible()
})

test('build writes a report that names its truncation and marks events without an original', async ({ page }) => {
  const dir = join(ctx.root, 'truncated')
  const out = join(dir, 'report')
  try {
    const trace = await generateTrace(dir, 10000)
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: ctx.homes.main.home }
    for (const name of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GROK_HOME']) {
      delete env[name]
    }
    await exec(process.execPath, [ctx.bin, 'build', trace, '--out-dir', out], { cwd: dir, env })
    await page.goto(pathToFileURL(join(out, 'index.html')).href)
    await expect(page.getByTestId('ledger')).toBeVisible()
    await expect(page.getByTestId('report-truncated')).toHaveText(/first 2,000 of 10,\d{3} events/)
    await page.getByTestId('ledger').evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await page.locator('[data-row-type=event]').last().click()
    await page.getByRole('tab', { name: 'Raw' }).click()
    await expect(activePanel(page)).toContainText('not included in this report')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
