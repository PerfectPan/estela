import type { Page } from '@playwright/test'
import type { EmbedSourceMode } from './embed-harness.ts'
import { loadFixtureReportJson, startEmbedHost } from './embed-harness.ts'
import { ctx, expect, test } from './harness.ts'
import {
  assertCdS1AcrossCompaction,
  assertS7AfterCompaction,
  assertS7WithSnapshot,
  selectRequest,
} from './workspace-checks.ts'

const sessions = ctx.homes.main

async function withEmbedHost<T>(
  sessionPath: string,
  slug: string,
  run: (
    open: (
      page: Page,
      options?: { mode?: EmbedSourceMode; theme?: 'dark' | 'light'; lang?: string },
    ) => Promise<string>,
  ) => Promise<T>,
): Promise<T> {
  const reportJson = await loadFixtureReportJson(sessionPath, slug)
  const host = await startEmbedHost(reportJson)
  try {
    return await run(async (page, options = {}) => {
      const params = new URLSearchParams({
        mode: options.mode ?? 'ready',
        theme: options.theme ?? 'dark',
        lang: options.lang ?? 'en',
      })
      const targetUrl = host.url(`/host/session?${params.toString()}#host-anchor`)
      await page.goto(targetUrl)
      return targetUrl
    })
  } finally {
    await host.close()
  }
}

test('DSH-2 / S7: Model saw after a compaction works inside <estela-workspace>', async ({ page }) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    await open(page)
    await expect(page.getByTestId('ledger')).toBeVisible()
    await assertS7AfterCompaction(page)
  })
})

test('DSH-2 / S7: Model saw with prompt snapshots works inside <estela-workspace>', async ({ page }) => {
  await withEmbedHost(sessions.claudeSnapshot, 'snapshot', async open => {
    await open(page)
    await expect(page.getByTestId('ledger')).toBeVisible()
    await assertS7WithSnapshot(page)
  })
})

test('DSH-2 / CD-S1: Compare across a compaction works inside <estela-workspace>', async ({ page }) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    await open(page)
    await expect(page.getByTestId('ledger')).toBeVisible()
    await assertCdS1AcrossCompaction(page)
  })
})

test('DSH-11: host tokens, inherited styles, theme/lang attributes, and @property styles stay isolated', async ({
  page,
}) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    await open(page, { theme: 'dark', lang: 'en' })
    await expect(page.getByTestId('ledger')).toBeVisible()
    await selectRequest(page, '600 in')

    const dark = await page.evaluate(() => {
      const el = document.getElementById('ws')!
      const style = getComputedStyle(el)
      const selected = el.shadowRoot!.querySelector<HTMLElement>('[role=option][aria-selected="true"]')
      return {
        hostLang: document.documentElement.lang,
        hostTheme: document.documentElement.dataset.theme,
        background: style.backgroundColor,
        color: style.color,
        textTransform: style.textTransform,
        fontStyle: style.fontStyle,
        letterSpacing: style.letterSpacing,
        selectedShadow: selected ? getComputedStyle(selected).boxShadow : 'missing',
        sharedCount: document.querySelectorAll('style[data-estela-shared]').length,
      }
    })

    expect(dark.hostLang).toBe('fr')
    expect(dark.hostTheme).toBe('host-page')
    expect(dark.background).toBe('rgb(13, 16, 19)')
    expect(dark.color).toBe('rgb(230, 233, 236)')
    expect(dark.textTransform).toBe('none')
    expect(dark.fontStyle).toBe('normal')
    expect(dark.letterSpacing).toBe('normal')
    expect(dark.selectedShadow).not.toBe('none')
    expect(dark.selectedShadow).not.toBe('missing')
    expect(dark.sharedCount).toBe(1)

    await page.evaluate(() => {
      window.__embed!.setTheme('light')
      window.__embed!.setLang('zh-CN')
    })
    await expect(page.getByRole('tab', { name: '模型所见' })).toBeVisible()

    const lightZh = await page.evaluate(() => {
      const el = document.getElementById('ws')!
      return {
        hostLang: document.documentElement.lang,
        hostTheme: document.documentElement.dataset.theme,
        background: getComputedStyle(el).backgroundColor,
        nav: el.shadowRoot!.querySelector('nav')?.textContent ?? '',
      }
    })

    expect(lightZh.hostLang).toBe('fr')
    expect(lightZh.hostTheme).toBe('host-page')
    expect(lightZh.background).toBe('rgb(251, 250, 248)')
    expect(lightZh.nav).toContain('会话')

    await page.evaluate(() => window.__embed!.disconnect())
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('style[data-estela-shared]').length)).toBe(0)
  })
})

test('A7, A8, B8: Jump to, inspector arrow keys, failed load, and Try again never change the host URL', async ({
  page,
}) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    const initialUrl = await open(page, { mode: 'fail-once' })
    await expect(page.getByTestId('load-error')).toBeVisible()
    await expect(page.locator('estela-workspace a[href^="#"]')).toHaveCount(0)
    expect(page.url()).toBe(initialUrl)

    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByTestId('ledger')).toBeVisible()
    expect(page.url()).toBe(initialUrl)

    // Embedded chrome omits #/ links, theme/language switches, and Export report.
    await expect(page.locator('estela-workspace a[href^="#"]')).toHaveCount(0)
    await expect(page.getByTestId('theme-switch')).toHaveCount(0)
    await expect(page.getByTestId('language-switch')).toHaveCount(0)
    await expect(page.getByTestId('export-report')).toHaveCount(0)

    // Jump to focuses the ledger inside the shadow root without touching location.href.
    await page.getByRole('button', { name: /Jump to/ }).click()
    const focusedLedger = await page.evaluate(() =>
      document.getElementById('ws')?.shadowRoot?.activeElement?.getAttribute('data-testid'),
    )
    expect(focusedLedger).toBe('ledger')
    expect(page.url()).toBe(initialUrl)

    // Arrow keys move focus across inspector tabs inside the shadow root without touching location.href.
    await selectRequest(page, '600 in')
    const inputTab = page.getByRole('tab', { name: 'Input' })
    await inputTab.focus()
    await page.keyboard.press('ArrowRight')
    const focusedTab = await page.evaluate(() => document.getElementById('ws')?.shadowRoot?.activeElement?.id)
    expect(focusedTab).toBe('inspector-tab-output')
    await page.keyboard.press('End')
    const lastTab = await page.evaluate(() => document.getElementById('ws')?.shadowRoot?.activeElement?.id)
    expect(lastTab).toBe('inspector-tab-raw')

    expect(page.url()).toBe(initialUrl)
    expect(await page.evaluate(() => location.href)).toBe(initialUrl)
  })
})

test('DSH-6: a throwing source stays contained inside the element and leaves the host page intact', async ({
  page,
}) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    const initialUrl = await open(page, { mode: 'throw' })
    await expect(page.getByTestId('load-error')).toBeVisible()
    await expect(page.getByTestId('load-error')).toContainText('Could not open this session')
    await expect(page.getByTestId('load-error')).toContainText('channel exploded')
    await expect(page.getByTestId('host-chrome')).toBeVisible()
    await expect(page.getByTestId('host-chrome')).toHaveText('Host page chrome')
    expect(page.url()).toBe(initialUrl)
  })
})

async function expectRetryRecovers(page: Page, initialUrl: string, expectedOpens: number) {
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByTestId('ledger')).toBeVisible()
  await expect(page.getByTestId('host-chrome')).toBeVisible()
  const state = await page.evaluate(() => ({
    openCalls: window.__embed!.openCalls(),
    sameElement: window.__embed!.isSameElement(),
    sameSource: window.__embed!.isSameSource(),
  }))
  expect(state).toEqual({ openCalls: expectedOpens, sameElement: true, sameSource: true })
  expect(page.url()).toBe(initialUrl)
}

test('DSH-6: Try again recovers after a rejected open without replacing the element or source', async ({ page }) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    const initialUrl = await open(page, { mode: 'fail-once' })
    await expect(page.getByTestId('load-error')).toContainText('temporary open failure')
    await expect(page.getByTestId('host-chrome')).toBeVisible()
    await expectRetryRecovers(page, initialUrl, 2)
  })
})

test('DSH-6: a post-load event() failure offers Try again and reopens without replacing the element', async ({
  page,
}) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    const initialUrl = await open(page, { mode: 'event-fail' })
    await expect(page.getByTestId('ledger')).toBeVisible()

    await selectRequest(page, '600 in')
    await page.getByRole('tab', { name: 'Raw' }).click()

    await expect(page.getByTestId('load-error')).toBeVisible()
    await expect(page.getByTestId('load-error')).toContainText('transport closed')
    await expect(page.locator('estela-workspace a[href^="#"]')).toHaveCount(0)
    await expect(page.getByTestId('host-chrome')).toBeVisible()
    await expectRetryRecovers(page, initialUrl, 2)
  })
})

test('DSH-7: a slow source shows indeterminate loading and enters the workspace once resolved', async ({ page }) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    await open(page, { mode: 'slow' })
    const loading = page.getByTestId('loading')
    await expect(loading).toBeVisible()
    await expect(loading).toContainText('Opening session')
    await expect(loading).toContainText('Loading…')
    await expect(page.getByTestId('host-chrome')).toBeVisible()

    await page.evaluate(() => window.__embed!.resolveOpen())
    await expect(loading).toBeHidden()
    await expect(page.getByTestId('ledger')).toBeVisible()
  })
})
