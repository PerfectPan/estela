import type { Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { ctx, expect, openWorkspace, test } from './harness.ts'

const exec = promisify(execFile)
const sessions = ctx.homes.main

/** Selects the request with `input` input tokens (600 is the first after the compaction). */
async function selectRequest(page: Page, input: string) {
  // `hasText` ignores case, so "REQUEST" alone would also match a turn header's "1 request".
  await page.locator('[role=option]').filter({ hasText: 'REQUEST' }).filter({ hasText: input }).click()
}

/** The Compare tab of the selected request. */
async function openCompare(page: Page) {
  await page.getByRole('tab', { name: 'Compare' }).click()
  const compare = page.getByTestId('context-compare')
  await expect(compare).toBeVisible()
  return compare
}

test('CD-S1, CD-S4: across a compaction, the diff lists exactly the events Model saw reports dropped', async ({
  page,
  launch,
}) => {
  await openWorkspace(page, launch, sessions.claudeRising)
  await selectRequest(page, '600 in')
  await page.getByRole('tab', { name: 'Model saw' }).click()
  const dropped = Number((await page.getByTestId('dropped-count').innerText()).replace(/\D/g, ''))
  expect(dropped).toBeGreaterThan(0)
  await page.getByTestId('open-compare').click()
  const compare = page.getByTestId('context-compare')
  await expect(compare).toBeVisible()
  // The default is the previous request on the lane, the last one before the compaction (3k).
  await expect(compare.getByTestId('compare-pick')).toHaveValue(/.+/)
  await expect(compare.getByTestId('compare-tokens')).toContainText('3k → 600')
  await expect(compare.getByTestId('compare-tokens')).toContainText('−2.4k input tokens')
  await expect(compare.getByTestId('compare-compaction')).toContainText('3.5k → 400')
  await expect(compare.getByTestId('compare-compacted')).toHaveAttribute('data-count', String(dropped))
  await expect(compare.getByTestId('compare-entered')).toContainText('Summary of the earlier conversation.')
  // This log records neither the system prompt nor the tool list: hatched and unavailable, never compared.
  for (const slot of ['system', 'tools']) {
    await expect(compare.locator(`[data-slot=${slot}]`)).toHaveAttribute('data-change', 'unavailable')
    await expect(compare.locator(`[data-slot=${slot}] .hatched`)).toHaveCount(1)
  }
  await expect(compare.locator('[data-slot=summary]')).toHaveAttribute('data-change', 'changed')
  await expect(compare).toContainText('Counts are events, not tokens')
})

test('CD-S2, CD-S3: the before-compaction quick pick and a Shift-click on the timeline choose the comparison', async ({
  page,
  launch,
}) => {
  await openWorkspace(page, launch, sessions.claudeRising)
  await selectRequest(page, '900 in')
  const compare = await openCompare(page)
  // The previous request (600) is after the compaction: nothing was hidden between them.
  await expect(compare.getByTestId('compare-tokens')).toContainText('600 → 900')
  await expect(compare.getByTestId('compare-compaction')).toHaveCount(0)
  await expect(compare.getByTestId('compare-compacted')).toHaveAttribute('data-count', '0')
  await compare.getByTestId('compare-before-compaction').click()
  await expect(compare.getByTestId('compare-tokens')).toContainText('3k → 900')
  await expect(compare.getByTestId('compare-compaction')).toHaveCount(1)

  // Shift-click the first bar (1k): it becomes the comparison, drawn with a dashed ring; the selection stays.
  const first = page.locator('rect[data-marker=request]').first()
  const box = (await first.boundingBox())!
  await page.keyboard.down('Shift')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.keyboard.up('Shift')
  await expect(compare.getByTestId('compare-tokens')).toContainText('1k → 900')
  await expect(page.getByTestId('compare-ring')).toHaveCount(1)
  await expect(page.getByTestId('inspector').locator('h2')).toContainText('Request')
})

test('CD-S5: a prompt snapshot makes the system prompt comparable, a slot recorded later stays unavailable', async ({
  page,
  launch,
}) => {
  await openWorkspace(page, launch, sessions.claudeSnapshot)
  await selectRequest(page, '600 in')
  const compare = await openCompare(page)
  const pick = compare.getByTestId('compare-pick')
  await pick.selectOption((await pick.locator('option', { hasText: /· 1k$/ }).getAttribute('value'))!)
  await expect(compare.getByTestId('compare-tokens')).toContainText('1k → 600')
  await expect(compare.locator('[data-slot=system]')).toHaveAttribute('data-change', 'same')
  // The tool list was first recorded after request 1, so the comparison has nothing to say about it.
  await expect(compare.locator('[data-slot=tools]')).toHaveAttribute('data-change', 'unavailable')
})

test('CD-S7: Compare works in a report opened from file:// and in Chinese', async ({ page }) => {
  const dir = join(ctx.root, 'compare-report')
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: sessions.home }
    for (const name of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'GROK_HOME']) {
      delete env[name]
    }
    await exec(process.execPath, [ctx.bin, 'build', sessions.claudeRising, '--out-dir', dir], { env })
    await page.goto(pathToFileURL(join(dir, 'index.html')).href)
    await expect(page.getByTestId('ledger')).toBeVisible()
    await selectRequest(page, '600 in')
    const compare = await openCompare(page)
    await expect(compare.getByTestId('compare-tokens')).toContainText('3k → 600')
    await page.getByTestId('language-switch').click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(page.getByRole('tab', { name: '对比' })).toHaveAttribute('aria-selected', 'true')
    await expect(compare).toContainText('被压缩隐藏')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
