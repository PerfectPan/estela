import type { Page } from '@playwright/test'
import { ctx, expect, test } from './harness.ts'

const HOSTS = ['claude-code', 'codex', 'grok'] as const

/** The count at the right of a host's rail row. */
function railCount(page: Page, host: string) {
  return page.locator(`button[data-host="${host}"] > span`).last()
}

test('S1: the opened URL shows sessions from all three hosts with per-host counts', async ({ page, launch }) => {
  // Auth on: the opener gets DevFrame's one-time code in the URL, as a user's browser would.
  const server = await launch({ waitOpened: true })
  const [opened] = server.opened()
  expect(opened).toContain('#devframe_otp=')
  await page.goto(opened!)
  const { counts } = ctx.homes.main
  await expect(page.locator('[data-ref]')).toHaveCount(counts['claude-code'] + counts.codex + counts.grok)
  for (const host of HOSTS) {
    await expect(page.locator(`[data-ref][data-host="${host}"]`)).toHaveCount(counts[host])
    await expect(railCount(page, host)).toHaveText(String(counts[host]))
  }
})

test('S3: a home without ~/.codex shows Codex with 0 and the checked path', async ({ page, launch }) => {
  const { home, counts } = ctx.homes.noCodex
  const server = await launch({ args: ['--no-auth', '--no-open'], home })
  await page.goto(server.base)
  await expect(railCount(page, 'codex')).toHaveText('0')
  await expect(page.locator('button[data-host="codex"]')).toContainText('~/.codex')
  for (const host of ['claude-code', 'grok'] as const) {
    await expect(page.locator(`[data-ref][data-host="${host}"]`)).toHaveCount(counts[host])
    await expect(railCount(page, host)).toHaveText(String(counts[host]))
  }
  await expect(page.locator('[data-ref][data-host="codex"]')).toHaveCount(0)
})

test('S4: an unknown format generation is listed as "could not read", and opening it shows host, file, and line', async ({ page, launch }) => {
  const server = await launch({ args: ['--no-auth', '--no-open'] })
  await page.goto(server.base)
  const row = page.locator('[data-ref][data-host="claude-code"]').filter({ hasText: 'Could not read' })
  await expect(row).toHaveCount(1)
  // Selecting it shows why in the preview: the list does not open a file it cannot read.
  await row.click()
  const preview = page.getByTestId('read-error')
  await expect(preview).toContainText('app-unknown-generation/session.jsonl')
  await expect(preview).toContainText('line 1')
  await expect(preview).toContainText('unknown format generation')
  // Opening its workspace by ref shows host, file, and line in the error panel.
  await page.goto(`${server.base}#/s/${await row.getAttribute('data-ref')}`)
  const panel = page.getByTestId('load-error')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Claude Code')
  await expect(panel).toContainText('app-unknown-generation/session.jsonl')
  await expect(panel).toContainText(/Line\s*1/)
  await expect(panel).toContainText('unknown format generation')
})
