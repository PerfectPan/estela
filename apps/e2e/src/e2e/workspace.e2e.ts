import { rm } from 'node:fs/promises'
import { writeTranscriptFixture } from './transcript-fixture.ts'
import { join } from 'node:path'
import { ctx, expect, generateTrace, openWorkspace, test } from './harness.ts'
import { assertS7AfterCompaction, assertS7WithSnapshot } from './workspace-checks.ts'

const sessions = ctx.homes.main

test('lane layout preserves selection, folds with mouse and keyboard, and retains cross-turn hooks', async ({
  page,
  launch,
}) => {
  const file = join(ctx.root, 'lane-layout.trace.json')
  const source = { file: 'synthetic', offset: 0, length: 1, line: 1 }
  const events = [
    { id: 'p1', kind: 'user', payload: { text: 'first' } },
    { id: 'spawn', kind: 'tool_call', payload: { callId: 'spawn', name: 'Task' } },
    { id: 'r1', kind: 'request', agentId: 'sub', payload: {} },
    { id: 'a1', kind: 'assistant', agentId: 'sub', payload: { text: 'subagent reply' } },
    { id: 'h1', kind: 'hook', agentId: 'sub', payload: { type: 'hook_success' } },
    { id: 'p2', kind: 'user', payload: { text: 'second' } },
    { id: 'h2', kind: 'hook', agentId: 'sub', payload: { type: 'hook_success' } },
  ].map((event, seq) => ({ ...event, seq, ts: 1000 * (seq + 1), source: { ...source, line: seq + 1 } }))
  await writeTranscriptFixture({
    file,
    sessionId: 'lane-ui',
    capabilities: ['subagents', 'hooks'],
    agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 'spawn', title: 'Worker' }],
    events,
  })
  await openWorkspace(page, launch, file)
  const ledger = page.getByTestId('ledger')
  const spawn = ledger.locator('[data-row-type=subagent]').first()
  await spawn.click()
  await page.getByTestId('layout-lanes').click()
  await expect(page.locator('#ledger-row-e_spawn')).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('layout-turns').click()
  await expect(spawn).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('layout-lanes').click()
  await page.locator('#ledger-row-e_a1').click()
  await page.getByTestId('layout-turns').click()
  await expect(page.locator('#ledger-row-e_a1')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#ledger-row-e_a1')).toBeVisible()
  await page.getByTestId('layout-lanes').click()
  await page.locator('#ledger-row-h_h1').click()
  await page.getByTestId('layout-turns').click()
  await expect(page.locator('#ledger-row-h_h1')).toHaveAttribute('aria-selected', 'true')
  await page.getByTestId('layout-lanes').click()
  await expect(page.locator('#ledger-row-h_h1')).toHaveAttribute('aria-selected', 'true')
  const main = ledger.locator('[data-row-type=lane]').first()
  await expect(main).toContainText('Main agent')
  await main.click()
  await page.getByTestId('layout-lanes').click()
  await expect(main).toHaveAttribute('aria-selected', 'true')
  await expect(main).toHaveAttribute('aria-expanded', 'false')
  await ledger.focus()
  await page.keyboard.press('Enter')
  await expect(main).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Space')
  await expect(main).toHaveAttribute('aria-expanded', 'false')
  await main.click()
  const hooks = ledger.locator('[data-row-type=hooks]')
  await expect(hooks).toHaveCount(2)
  await hooks.nth(0).click()
  await ledger.focus()
  await page.keyboard.press('Enter')
  await hooks.nth(1).click()
  await ledger.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#ledger-row-e_h1')).toBeVisible()
  await expect(page.locator('#ledger-row-e_h2')).toBeVisible()
  await page.getByTestId('layout-turns').click()
  await page.getByRole('radio', { name: 'Requests', exact: true }).click()
  await spawn.click()
  await page.getByTestId('layout-lanes').click()
  await expect(page.locator('#ledger-row-l_sub')).toHaveAttribute('aria-selected', 'true')
})

/** `m:ss` or `h:mm:ss` from the ledger's time column, in ms. */
function elapsedMs(text: string): number {
  return (
    text
      .split(':')
      .map(Number)
      .reduce((total, part) => total * 60 + part, 0) * 1000
  )
}

test('S2: the opened ?s=<traceId> URL lands on #/s/<traceId> through the one-time code', async ({ page, launch }) => {
  const server = await launch({ args: [sessions.claudePlain], waitOpened: true })
  const [opened] = server.opened()
  expect(opened).toMatch(new RegExp(`\\?s=${server.traceId}#devframe_otp=\\w+$`))
  await page.goto(opened!)
  await expect(page.getByTestId('ledger')).toBeVisible()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/s/${server.traceId}`)
  expect(new URL(page.url()).searchParams.has('s')).toBe(false)
  await expect(page.getByTestId('export-report')).toBeVisible()
})

test('S5: bars rise to a labeled dashed compaction rule and are lower after it', async ({ page, launch }) => {
  await openWorkspace(page, launch, sessions.claudeRising)
  const rule = page.locator('[data-marker=compaction]')
  await expect(rule).toHaveCount(1)
  // The agent recorded both counts: pre 3,500 and post 400.
  await expect(rule).toHaveAttribute('data-label', 'compacted  3.5k → 400')
  const at = Number(await rule.getAttribute('x')) + 4
  const bars = await page.locator('rect[data-marker=request]').evaluateAll(rects =>
    rects.map(rect => ({
      x: Number(rect.getAttribute('x')) + 1.5,
      height: Number(rect.getAttribute('height')),
    })),
  )
  const before = bars.filter(bar => bar.x < at).map(bar => bar.height)
  const after = bars.filter(bar => bar.x > at).map(bar => bar.height)
  expect(before).toHaveLength(3)
  expect(after).toHaveLength(2)
  expect(before[0]!).toBeLessThan(before[1]!)
  expect(before[1]!).toBeLessThan(before[2]!)
  expect(Math.max(...after)).toBeLessThan(before[2]!)
})

test('S6: a brush filters the ledger to its range, by mouse drag and by keyboard on a focused handle', async ({
  page,
  launch,
}) => {
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
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('S7: Model saw at the first request after a compaction', async ({ page, launch }) => {
  await openWorkspace(page, launch, sessions.claudeRising)
  await assertS7AfterCompaction(page)
})

test('S7: Model saw shows the system prompt and tools a prompt snapshot recorded', async ({ page, launch }) => {
  await openWorkspace(page, launch, sessions.claudeSnapshot)
  await assertS7WithSnapshot(page)
})
