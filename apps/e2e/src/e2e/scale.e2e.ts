import type { Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { activePanel, ctx, expect, generateCodex, generateTrace, openWorkspace, test } from './harness.ts'

/** The page's `window.longTasks`, typed by this `declare global` merge. */
declare global {
  interface Window {
    /** Long-task durations collected by this suite's `PerformanceObserver` on the page. */
    longTasks: number[]
  }
}

/** The view budget: at most 12 MB reaches the browser before an event is selected. */
const BUDGET = 12 * 1000 * 1000
/** S12 file size. S12 asks for at least 350 MB; a smaller value is only for trying the suite quickly. */
const S12_BYTES = Number(process.env.AGENT_TRACE_E2E_S12_BYTES ?? 350 * 1024 * 1024)

/** Measured numbers go to the test's output (and CI log) and to its annotations. */
function note(type: string, description: string): void {
  test.info().annotations.push({ type, description })
  process.stdout.write(`${type}: ${description}\n`)
}

test('S8: 10,000 events scroll with fewer than 100 rendered rows and no long task over 200 ms', async ({
  page,
  launch,
}) => {
  const dir = join(ctx.root, 's8')
  try {
    await openWorkspace(page, launch, await generateTrace(dir, 10000))
    await expect(page.getByTestId('timeline-range')).toContainText(/10,\d{3} events/)
    await page.evaluate(() => {
      window.longTasks = []
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          window.longTasks.push(entry.duration)
        }
      }).observe({ type: 'longtask' })
    })
    const ledger = page.getByTestId('ledger')
    const box = (await ledger.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const state = () =>
      ledger.evaluate(element => ({
        top: element.scrollTop,
        end: element.scrollHeight - element.clientHeight,
        rows: element.querySelectorAll('[role=option]').length,
      }))
    let maxRows = 0
    let steps = 0
    for (let current = await state(); current.top < current.end - 1 && steps < 2000; steps++) {
      const before = current.top
      await page.mouse.wheel(0, 1200)
      // Each step moves the list; wait for the scroll, then count what is drawn.
      await expect.poll(async () => (current = await state()).top).toBeGreaterThan(before)
      maxRows = Math.max(maxRows, current.rows)
    }
    const longTasks = await page.evaluate(() => window.longTasks)
    note(
      'S8',
      `${steps} scroll steps, at most ${maxRows} rendered rows, longest task ${Math.round(Math.max(0, ...longTasks))} ms`,
    )
    expect(steps).toBeGreaterThan(50)
    expect(maxRows).toBeLessThan(100)
    expect(longTasks.filter(duration => duration > 200)).toEqual([])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

/** Bytes the page received: HTTP bodies and WebSocket frames. */
function countBytes(page: Page): () => number {
  let bytes = 0
  page.on('response', response => {
    void response.body().then(
      body => (bytes += body.byteLength),
      () => {},
    )
  })
  page.on('websocket', socket => {
    socket.on('framereceived', frame => {
      bytes += typeof frame.payload === 'string' ? Buffer.byteLength(frame.payload) : frame.payload.byteLength
    })
  })
  return () => bytes
}

test('S12: a 350 MB Codex file opens after progress, within 12 MB, and a shortened output loads in full', async ({
  page,
  launch,
}) => {
  test.setTimeout(600_000)
  const home = join(ctx.root, 's12-home')
  const sessions = join(home, '.codex/sessions/2026/01/01')
  await mkdir(sessions, { recursive: true })
  try {
    const large = await generateCodex(sessions, S12_BYTES)
    note('S12 file', `${large.bytes} bytes, ${large.turns} turns, ${large.longOutputs} outputs over 4,096 characters`)
    const received = countBytes(page)
    const server = await launch({ args: ['--no-auth', '--no-open'], home })
    await page.goto(server.base)
    const row = page.locator('[data-trace-id][data-agent="codex"]')
    await expect(row).toHaveCount(1)
    const started = Date.now()
    await row.dblclick()
    await expect(page.getByTestId('loading')).toContainText(' of ')
    await expect(page.getByTestId('ledger')).toBeVisible({ timeout: 300_000 })
    note('S12 load', `${Date.now() - started} ms from open to ledger`)
    // Everything sent before a selection: wait until the count stops growing over two polls.
    let last = -1
    await expect
      .poll(
        () => {
          const now = received()
          const settled = now === last
          last = now
          return settled
        },
        { intervals: [250] },
      )
      .toBe(true)
    const before = received()
    note('S12 bytes', `${before} bytes received before any selection`)
    expect(before).toBeLessThanOrEqual(BUDGET)

    const shortened = page.getByTestId('shortened').first()
    await expect(shortened).toBeVisible()
    await shortened.click()
    await page.getByRole('tab', { name: 'Output' }).click()
    await expect(activePanel(page).getByTestId('shortened-notice')).toContainText('Showing the full text', {
      timeout: 60_000,
    })
    const output = await activePanel(page).getByTestId('inspector-body').innerText()
    expect(output.length).toBeGreaterThan(4096)
    await page.getByRole('tab', { name: 'Raw' }).click()
    await expect(activePanel(page)).toContainText('"type": "response_item"', { timeout: 60_000 })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
