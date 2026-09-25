import { activePanel, ctx, expect, openWorkspace, test } from './harness.ts'

test('S2: the opened ?s=<ref> URL lands on #/s/<ref> through the one-time code', async ({ page, launch }) => {
  const server = await launch({ args: [ctx.homes.sessions.claudePlain], waitOpened: true })
  const [opened] = server.opened()
  expect(opened).toMatch(new RegExp(`\\?s=${server.ref}#devframe_otp=\\w+$`))
  await page.goto(opened!)
  await expect(page.getByTestId('ledger')).toBeVisible()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/s/${server.ref}`)
  expect(new URL(page.url()).searchParams.has('s')).toBe(false)
  await expect(page.getByTestId('export-report')).toBeVisible()
})

test('S5: a compaction draws a labeled dashed rule, with lower bars after it', async ({ page, launch }) => {
  await openWorkspace(page, launch, ctx.homes.sessions.claudeCompaction)
  const rule = page.locator('[data-marker=compaction]')
  await expect(rule).toHaveCount(1)
  // `compacted  <pre> → <post>`: the host recorded both counts.
  await expect(rule).toHaveAttribute('data-label', /compacted\s+\S+ → \S+/)
  const at = Number(await rule.getAttribute('x')) + 4
  const bars = await page.locator('rect[data-marker=request]').evaluateAll(rects => rects.map(rect => ({
    x: Number(rect.getAttribute('x')) + 1.5,
    height: Number(rect.getAttribute('height')),
  })))
  const before = bars.filter(bar => bar.x < at)
  const after = bars.filter(bar => bar.x > at)
  expect(before.length).toBeGreaterThan(0)
  expect(after.length).toBeGreaterThan(0)
  expect(after[0]!.height).toBeLessThan(before.at(-1)!.height)
})

test('S6: a brush filters the ledger, by mouse drag and by keyboard on a focused handle', async ({ page, launch }) => {
  await openWorkspace(page, launch, ctx.homes.sessions.claudeCompaction)
  const range = page.getByTestId('timeline-range')
  const all = await range.innerText()
  const total = Number(/(\d+) events/.exec(all)![1])
  const plot = (await page.getByTestId('timeline-plot').boundingBox())!
  await page.mouse.move(plot.x + plot.width * 0.55, plot.y + plot.height / 2)
  await page.mouse.down()
  await page.mouse.move(plot.x + plot.width * 0.98, plot.y + plot.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(range).toContainText('selected')
  const selected = Number(/(\d+) events/.exec(await range.innerText())![1])
  expect(selected).toBeLessThan(total)
  const rows = page.locator('[data-testid=ledger] [role=option]')
  await expect.poll(() => rows.filter({ hasNot: page.locator('[data-row-type=turn]') }).count()).toBeLessThan(total)

  const from = page.getByTestId('brush-from')
  await from.focus()
  const start = Number(await from.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowRight')
  const step = Number(await from.getAttribute('aria-valuenow'))
  expect(step).toBeGreaterThan(start)
  await page.keyboard.press('Shift+ArrowLeft')
  expect(Number(await from.getAttribute('aria-valuenow'))).toBeLessThan(step)
  await page.keyboard.press('Escape')
  await expect(range).toHaveText(all)
})

test('S7: Model saw after a compaction shows the slots, unavailable ones hatched, and the removed events', async ({ page, launch }) => {
  await openWorkspace(page, launch, ctx.homes.sessions.claudeCompaction)
  await page.locator('[role=option]').filter({ hasText: 'REQUEST' }).last().click()
  await page.getByRole('tab', { name: 'Model saw' }).click()
  const saw = page.getByTestId('model-saw')
  await expect(saw).toBeVisible()
  // Claude Code records neither the system prompt nor the tool list (S7).
  await expect(saw.locator('[data-slot=system]')).toHaveAttribute('data-status', 'unavailable')
  await expect(saw.locator('[data-slot=tools]')).toHaveAttribute('data-status', 'unavailable')
  await expect(saw.locator('[data-slot=summary]')).toHaveAttribute('data-status', 'present')
  await expect(saw.locator('[data-slot=system] .hatched')).toHaveCount(1)
  await expect(saw.getByTestId('dropped').locator('li')).not.toHaveCount(0)
  await expect(activePanel(page)).toContainText('Dropped by compaction')
})
