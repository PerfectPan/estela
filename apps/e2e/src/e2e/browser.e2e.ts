import { ctx, expect, test } from './harness.ts'

const HOSTS = ['claude-code', 'codex', 'grok'] as const

test('S1: the opened URL shows sessions from all three hosts with per-host counts', async ({ page, launch }) => {
  // Auth on: the opener gets DevFrame's one-time code in the URL, as a user's browser would.
  const server = await launch({ waitOpened: true })
  const [opened] = server.opened()
  expect(opened).toContain('#devframe_otp=')
  await page.goto(opened!)
  await expect(page.locator('[data-ref]')).toHaveCount(Object.values(ctx.homes.counts).reduce((sum, count) => sum + count, 0))
  for (const host of HOSTS) {
    const count = ctx.homes.counts[host]
    await expect(page.locator(`[data-ref][data-host="${host}"]`)).toHaveCount(count)
    await expect(page.locator(`button[data-host="${host}"]`)).toContainText(String(count))
  }
})

test('S3: a home without ~/.codex shows Codex with 0 and the checked path', async ({ page, launch }) => {
  const server = await launch({ args: ['--no-auth', '--no-open'], home: ctx.homes.noCodex })
  await page.goto(server.base)
  const codex = page.locator('button[data-host="codex"]')
  await expect(codex).toContainText('0')
  await expect(codex).toContainText('.codex')
  await expect(page.locator('[data-ref][data-host="claude-code"]')).toHaveCount(ctx.homes.counts['claude-code'])
  await expect(page.locator('[data-ref][data-host="grok"]')).toHaveCount(ctx.homes.counts.grok)
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
