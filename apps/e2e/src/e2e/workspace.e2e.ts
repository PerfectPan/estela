import type { Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { activePanel, ctx, expect, generateTrace, openWorkspace, test } from './harness.ts'

const sessions = ctx.homes.main

/** `m:ss` or `h:mm:ss` from the ledger's time column, in ms. */
function elapsedMs(text: string): number {
  return text.split(':').map(Number).reduce((total, part) => total * 60 + part, 0) * 1000
}

test('S2: the opened ?s=<ref> URL lands on #/s/<ref> through the one-time code', async ({ page, launch }) => {
  const server = await launch({ args: [sessions.claudePlain], waitOpened: true })
  const [opened] = server.opened()
  expect(opened).toMatch(new RegExp(`\\?s=${server.ref}#devframe_otp=\\w+$`))
  await page.goto(opened!)
  await expect(page.getByTestId('ledger')).toBeVisible()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/s/${server.ref}`)
  expect(new URL(page.url()).searchParams.has('s')).toBe(false)
  await expect(page.getByTestId('export-report')).toBeVisible()
})

test('S5: bars rise to a labeled dashed compaction rule and are lower after it', async ({ page, launch }) => {
  await openWorkspace(page, launch, sessions.claudeRising)
  const rule = page.locator('[data-marker=compaction]')
  await expect(rule).toHaveCount(1)
  // The host recorded both counts: pre 3,500 and post 400.
  await expect(rule).toHaveAttribute('data-label', 'compacted  3.5k → 400')
  const at = Number(await rule.getAttribute('x')) + 4
  const bars = await page.locator('rect[data-marker=request]').evaluateAll(rects => rects.map(rect => ({
    x: Number(rect.getAttribute('x')) + 1.5,
    height: Number(rect.getAttribute('height')),
  })))
  const before = bars.filter(bar => bar.x < at).map(bar => bar.height)
  const after = bars.filter(bar => bar.x > at).map(bar => bar.height)
  expect(before).toHaveLength(3)
  expect(after).toHaveLength(2)
  expect(before[0]!).toBeLessThan(before[1]!)
  expect(before[1]!).toBeLessThan(before[2]!)
  expect(Math.max(...after)).toBeLessThan(before[2]!)
})

test('S6: a brush filters the ledger to its range, by mouse drag and by keyboard on a focused handle', async ({ page, launch }) => {
  const dir = join(ctx.root, 's6')
  try {
    await openWorkspace(page, launch, await generateTrace(dir, 640))
    const range = page.getByTestId('timeline-range')
    const all = await range.innerText()
    const total = Number(/([\d,]+) events/.exec(all)![1]!.replaceAll(',', ''))
    const plot = (await page.getByTestId('timeline-plot').boundingBox())!
    await page.mouse.move(plot.x + plot.width * 0.4, plot.y + plot.height / 2)
    await page.mouse.down()
    await page.mouse.move(plot.x + plot.width * 0.7, plot.y + plot.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect(range).toContainText('selected')
    const selected = Number(/([\d,]+) events/.exec(await range.innerText())![1]!.replaceAll(',', ''))
    expect(selected).toBeGreaterThan(0)
    expect(selected).toBeLessThan(total)

    const from = page.getByTestId('brush-from')
    const to = page.getByTestId('brush-to')
    const inRange = async () => {
      const lo = Number(await from.getAttribute('aria-valuenow'))
      const hi = Number(await to.getAttribute('aria-valuenow'))
      const times = (await page.locator('[data-row-type=event] [data-testid=row-time]').allInnerTexts()).map(elapsedMs)
      expect(times.length).toBeGreaterThan(0)
      // The column shows whole seconds (rounded down).
      for (const time of times) {
        expect(time).toBeGreaterThanOrEqual(lo - 1000)
        expect(time).toBeLessThanOrEqual(hi)
      }
    }
    await inRange()

    await from.focus()
    const start = Number(await from.getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowRight')
    const step = Number(await from.getAttribute('aria-valuenow'))
    expect(step).toBeGreaterThan(start)
    await page.keyboard.press('Shift+ArrowRight')
    expect(Number(await from.getAttribute('aria-valuenow'))).toBeGreaterThan(step)
    await expect(range).not.toHaveText(`${selected} events`)
    await inRange()
    await page.keyboard.press('Escape')
    await expect(range).toHaveText(all)
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** Selects the first request after the compaction (600 input tokens) and opens "Model saw". */
async function openModelSaw(page: Page) {
  // `hasText` ignores case, so "REQUEST" alone would also match a turn header's "1 request".
  await page.locator('[role=option]').filter({ hasText: 'REQUEST' }).filter({ hasText: '600 in' }).click()
  await page.getByRole('tab', { name: 'Model saw' }).click()
  const saw = page.getByTestId('model-saw')
  await expect(saw).toBeVisible()
  return saw
}

test('S7: Model saw at the first request after a compaction', async ({ page, launch }) => {
  await openWorkspace(page, launch, sessions.claudeRising)
  const saw = await openModelSaw(page)
  await expect(page.getByTestId('inspector').locator('h2')).toHaveText('Request #12')
  // This log has no prompt snapshot, so it records neither the system prompt nor the tool list: hatched, "unavailable".
  for (const slot of ['system', 'tools']) {
    await expect(saw.locator(`[data-slot=${slot}]`)).toHaveAttribute('data-status', 'unavailable')
    await expect(saw.locator(`[data-slot=${slot}] .hatched`)).toHaveCount(1)
    await expect(saw.locator(`[data-slot=${slot}]`)).toContainText('unavailable')
  }
  await expect(saw).toContainText('The log of this session does not record the system prompt and tool definitions')
  for (const slot of ['summary', 'messages', 'currentTurn'])
    await expect(saw.locator(`[data-slot=${slot}]`)).toHaveAttribute('data-status', 'present')
  // The counts the host recorded, each with the slots it covers: the request's input tokens
  // (every slot) and the compaction's post tokens (everything before the current turn).
  const counts = saw.getByTestId('recorded-counts')
  await expect(counts.locator('[data-from="request.inputTokens"]')).toHaveAttribute('data-tokens', '600')
  await expect(counts.locator('[data-from="request.inputTokens"]')).toHaveAttribute('data-slots', 'system tools summary messages currentTurn')
  await expect(counts.locator('[data-from="compaction.postTokens"]')).toHaveAttribute('data-tokens', '400')
  await expect(counts.locator('[data-from="compaction.postTokens"]')).toHaveAttribute('data-slots', 'system tools summary messages')
  await expect(saw.getByTestId('dropped').locator('li')).not.toHaveCount(0)
  await expect(activePanel(page)).toContainText('Dropped by compaction')
})

test('S7: Model saw shows the system prompt and tools a prompt snapshot recorded', async ({ page, launch }) => {
  await openWorkspace(page, launch, sessions.claudeSnapshot)
  const saw = await openModelSaw(page)
  for (const slot of ['system', 'tools', 'summary', 'messages', 'currentTurn'])
    await expect(saw.locator(`[data-slot=${slot}]`)).toHaveAttribute('data-status', 'present')
  await expect(saw.locator('.hatched')).toHaveCount(0)
  await expect(saw).toContainText('complete')
  await expect(saw).not.toContainText('does not record')
  // The snapshots stay out of the events the compaction removed.
  await expect(saw.getByTestId('dropped')).not.toContainText('prompt_snapshot')
  await expect(saw.getByTestId('recorded-counts').locator('[data-from="request.inputTokens"]')).toHaveAttribute('data-tokens', '600')
})
