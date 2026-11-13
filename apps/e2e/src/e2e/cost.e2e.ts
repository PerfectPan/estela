import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { writeCostTrace } from '../cost-trace.ts'
import { ctx, expect, openWorkspace, test } from './harness.ts'

const exec = promisify(execFile)

test('cost: the header, turns, lanes, and a request show list prices, partial sums say so', async ({
  page,
  launch,
}) => {
  const dir = join(ctx.root, 'cost')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'cost.trace.json')
  await writeCostTrace(file)
  await openWorkspace(page, launch, file)

  const headline = page.getByTestId('session-cost')
  await expect(headline).toContainText('$0.08')
  await expect(headline).toContainText('1 of 4 requests unpriced')
  await expect(headline).toHaveAttribute('title', /LiteLLM \d{4}-\d{2}-\d{2} · [0-9a-f]{7}/)

  // The subagent's request counts in the turn that spawned it; the last turn's only request has no price.
  const turns = page.getByTestId('turn-totals')
  await expect(turns.nth(0)).toContainText('$0.05')
  await expect(turns.nth(1)).toContainText('$0.03')
  await expect(turns.nth(2)).toContainText('cost unavailable')

  await page.locator('#ledger-row-e_r1').click()
  const request = page.getByTestId('request-cost')
  await expect(request).toContainText('cache read $0.006')
  await expect(request).toContainText('cache write $0.02')
  await expect(request).toContainText('76% cache hits')
  await page.locator('#ledger-row-e_r3').click()
  await expect(request).toContainText('Cost unavailable: no price for claude-test')

  await page.getByTestId('layout-lanes').click()
  await expect(page.getByTestId('lane-totals').nth(1)).toContainText('$0.006')
})

test('cost: a report built from file:// shows the same numbers', async ({ page }) => {
  const dir = join(ctx.root, 'cost-report')
  const out = join(dir, 'report')
  try {
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'cost.trace.json')
    await writeCostTrace(file)
    await exec(process.execPath, [ctx.bin, 'build', file, '--out-dir', out], {
      cwd: dir,
      env: { ...process.env, HOME: ctx.homes.main.home },
    })
    await page.goto(pathToFileURL(join(out, 'index.html')).href)
    await expect(page.getByTestId('session-cost')).toContainText('$0.08')
    await expect(page.getByTestId('session-cost')).toContainText('1 of 4 requests unpriced')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
