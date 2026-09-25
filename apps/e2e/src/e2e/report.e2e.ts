import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { activePanel, ctx, expect, openWorkspace, test } from './harness.ts'

const exec = promisify(execFile)

async function filesContaining(dir: string, needle: string): Promise<string[]> {
  const hits: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && (await readFile(join(entry.parentPath, entry.name))).includes(needle))
      hits.push(join(entry.parentPath, entry.name))
  }
  return hits
}

test('S9: Export report writes a redacted report that opens from file:// without a server, in the export language', async ({ page, launch }) => {
  // Redaction off on the local server: the workspace shows the home path, the report never does.
  const server = await openWorkspace(page, launch, ctx.homes.sessions.claudeHomeCwd, { env: { AGENT_TRACE_REDACT: '0' } })
  await expect(page.locator('section').first()).toContainText(ctx.homes.main)

  // Export in Chinese: the report opens in the language it was exported in (plan 3.6).
  await page.getByTestId('language-switch').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await page.getByTestId('export-report').click()
  const dialog = page.getByTestId('export-dialog')
  await expect(dialog).toContainText('会话文本和文件内容仍保留在报告中')
  await page.getByTestId('export-confirm').click()
  const shown = (await dialog.getByTestId('export-path').innerText()).trim()
  expect(shown).toMatch(/agent-trace-report-[0-9a-f]{8}-\d{8}-\d{6}\/index\.html$/)
  // The server's working directory is outside the synthetic home, so the path is absolute.
  expect(shown.startsWith(realpathSync(server.cwd))).toBe(true)
  const dir = shown.slice(0, -'/index.html'.length)
  await dialog.getByRole('button', { name: '关闭' }).click()

  expect(await readdir(dir)).toEqual(['index.html'])
  expect(await filesContaining(dir, ctx.homes.main)).toEqual([])
  expect(await filesContaining(dir, homedir())).toEqual([])

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
  await report.locator('[role=option]').filter({ hasText: 'USER' }).first().click()
  await report.getByRole('tab', { name: 'Raw' }).click()
  await expect(activePanel(report)).toContainText('"type": "user"')
  await report.getByRole('tab', { name: 'Model saw' }).click()
  await expect(report.getByTestId('model-saw')).toBeVisible()
})

test('build writes a report that names its truncation and marks events without an original', async ({ page }) => {
  const dir = join(ctx.root, 'truncated')
  const { stdout } = await exec(process.execPath, [join(ctx.repo, 'scripts/generate-trace.mjs'), '--events', '10000', '--out', dir])
  const out = join(dir, 'report')
  try {
    await exec(process.execPath, [ctx.bin, 'build', stdout.split('\n')[0]!, '--out-dir', out], { cwd: dir, env: { ...process.env, HOME: ctx.homes.main } })
    await page.goto(pathToFileURL(join(out, 'index.html')).href)
    await expect(page.getByTestId('ledger')).toBeVisible()
    await expect(page.getByTestId('report-truncated')).toHaveText(/first 2,000 of 10,\d{3} events/)
    const ledger = page.getByTestId('ledger')
    await ledger.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await page.locator('[data-row-type=event]').last().click()
    await page.getByRole('tab', { name: 'Raw' }).click()
    await expect(activePanel(page)).toContainText('not included in this report')
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
})
