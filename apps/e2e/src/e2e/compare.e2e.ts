import type { Locator, Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { writeTranscriptFixture } from './transcript-fixture.ts'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { ctx, expect, openWorkspace, test } from './harness.ts'
import { assertCdS1AcrossCompaction, selectRequest } from './workspace-checks.ts'

const exec = promisify(execFile)
const sessions = ctx.homes.main

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
  await assertCdS1AcrossCompaction(page)
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

test('a click on a subagent lane selects its request, and Shift-click there picks the comparison on that lane', async ({
  page,
  launch,
}) => {
  const file = join(ctx.root, 'compare-sub-lane.trace.json')
  const source = { file: 'synthetic', offset: 0, length: 1, line: 1 }
  const request = (id: string, inputTokens: number, agentId?: string) => ({
    id,
    kind: 'request',
    ...(agentId ? { agentId } : {}),
    payload: { usage: { inputTokens } },
  })
  const events = [
    { id: 'p1', kind: 'user', payload: { text: 'start' } },
    request('q1', 1000),
    { id: 'spawn', kind: 'tool_call', payload: { callId: 'spawn', name: 'Task' } },
    request('s1', 200, 'sub'),
    request('s2', 500, 'sub'),
    request('s3', 900, 'sub'),
    request('q2', 1500),
  ].map((event, seq) => ({ ...event, seq, ts: 1000 * (seq + 1), source: { ...source, line: seq + 1 } }))
  await writeTranscriptFixture({
    file,
    sessionId: 'compare-sub-lane',
    capabilities: ['subagents'],
    agents: [{ id: 'main' }, { id: 'sub', parentId: 'main', spawnEventId: 'spawn', title: 'Worker' }],
    events,
  })
  const center = async (bar: Locator) => {
    const box = (await bar.boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const shiftClick = async (bar: Locator) => {
    const at = await center(bar)
    await page.keyboard.down('Shift')
    await page.mouse.click(at.x, at.y)
    await page.keyboard.up('Shift')
  }
  try {
    await openWorkspace(page, launch, file)
    const subBars = page.locator('g[data-lane=sub] rect[data-marker=subagent-request]')
    await expect(subBars).toHaveCount(3)
    const third = await center(subBars.nth(2))
    await page.mouse.click(third.x, third.y)
    const compare = await openCompare(page)
    // The previous request on the subagent lane, not on the main lane.
    await expect(compare.getByTestId('compare-tokens')).toContainText('500 → 900')

    await shiftClick(subBars.first())
    await expect(compare.getByTestId('compare-tokens')).toContainText('200 → 900')
    await expect(page.getByTestId('compare-ring')).toHaveCount(1)

    // Compare stays on one lane: Shift-click on the main lane selects that request instead.
    await shiftClick(page.locator('rect[data-marker=request]').first())
    await expect(compare.getByTestId('compare-tokens')).toContainText('1k → 1.5k')
  } finally {
    await rm(file, { force: true })
  }
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
