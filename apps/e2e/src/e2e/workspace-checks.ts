import type { Page } from '@playwright/test'
import { activePanel, expect } from './harness.ts'

/** Selects the request with `input` input tokens (600 is the first after the compaction). */
export async function selectRequest(page: Page, input = '600 in') {
  // `hasText` ignores case, so "REQUEST" alone would also match a turn header's "1 request".
  await page.locator('[role=option]').filter({ hasText: 'REQUEST' }).filter({ hasText: input }).click()
}

/** Selects the request with `input` input tokens and opens "Model saw". */
async function openModelSaw(page: Page, input = '600 in') {
  await selectRequest(page, input)
  await page.getByRole('tab', { name: 'Model saw' }).click()
  const saw = page.getByTestId('model-saw')
  await expect(saw).toBeVisible()
  return saw
}

/** S7 assertions on `claudeRising`: Model saw at the first request after a compaction. */
export async function assertS7AfterCompaction(page: Page) {
  const saw = await openModelSaw(page)
  await expect(page.getByTestId('inspector').locator('h2')).toHaveText('Request #12')
  // This log has no prompt snapshot, so it records neither the system prompt nor the tool list: hatched, "unavailable".
  for (const slot of ['system', 'tools']) {
    await expect(saw.locator(`[data-slot=${slot}]`)).toHaveAttribute('data-status', 'unavailable')
    await expect(saw.locator(`[data-slot=${slot}] .hatched`)).toHaveCount(1)
    await expect(saw.locator(`[data-slot=${slot}]`)).toContainText('unavailable')
  }
  await expect(saw).toContainText('The log of this session does not record the system prompt and tool definitions')
  for (const slot of ['summary', 'messages', 'currentTurn']) {
    await expect(saw.locator(`[data-slot=${slot}]`)).toHaveAttribute('data-status', 'present')
  }
  // The counts the agent recorded, each with the slots it covers: the request's input tokens
  // (every slot) and the compaction's post tokens (everything before the current turn).
  const counts = saw.getByTestId('recorded-counts')
  await expect(counts.locator('[data-from="request.inputTokens"]')).toHaveAttribute('data-tokens', '600')
  await expect(counts.locator('[data-from="request.inputTokens"]')).toHaveAttribute(
    'data-slots',
    'system tools summary messages currentTurn',
  )
  await expect(counts.locator('[data-from="compaction.postTokens"]')).toHaveAttribute('data-tokens', '400')
  await expect(counts.locator('[data-from="compaction.postTokens"]')).toHaveAttribute(
    'data-slots',
    'system tools summary messages',
  )
  await expect(saw.getByTestId('dropped').locator('li')).not.toHaveCount(0)
  await expect(activePanel(page)).toContainText('Dropped by compaction')
}

/** S7 assertions on `claudeSnapshot`: prompt snapshots make system prompt and tools present. */
export async function assertS7WithSnapshot(page: Page) {
  // Request #1 comes after the system-prompt snapshot and before the one with the tool list.
  const first = await openModelSaw(page, '1k in')
  await expect(first.locator('[data-slot=system]')).toHaveAttribute('data-status', 'present')
  await expect(first.locator('[data-slot=tools]')).toHaveAttribute('data-status', 'unavailable')
  await expect(first).toContainText(
    'The log of this session records tool definitions only after this event or on another lane',
  )
  await expect(first).not.toContainText('does not record')

  const saw = await openModelSaw(page)
  for (const slot of ['system', 'tools', 'summary', 'messages', 'currentTurn']) {
    await expect(saw.locator(`[data-slot=${slot}]`)).toHaveAttribute('data-status', 'present')
  }
  await expect(saw.locator('.hatched')).toHaveCount(0)
  await expect(saw).toContainText('complete')
  await expect(saw).not.toContainText('does not record')
  // The snapshots stay out of the events the compaction removed.
  await expect(saw.getByTestId('dropped')).not.toContainText('prompt_snapshot')
  await expect(saw.getByTestId('recorded-counts').locator('[data-from="request.inputTokens"]')).toHaveAttribute(
    'data-tokens',
    '600',
  )
  // The system prompt row links to the snapshot it comes from; its Input tab shows what the model saw.
  await saw.locator('[data-slot=system] [data-testid=slot-source]').click()
  await expect(page.getByTestId('inspector').locator('h2')).toContainText('#')
  await page.getByRole('tab', { name: 'Input' }).click()
  await expect(activePanel(page)).toContainText('You are a test agent.')
  await expect(activePanel(page)).toContainText('input_schema')
}

/** CD-S1 / CD-S4 assertions on `claudeRising`: Compare across a compaction matches dropped events. */
export async function assertCdS1AcrossCompaction(page: Page) {
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
}
