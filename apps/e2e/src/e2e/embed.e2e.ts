import type { Page } from '@playwright/test'
import type { EmbedSourceMode } from './embed-harness.ts'
import { loadFixtureReportJson, startEmbedHost } from './embed-harness.ts'
import { activePanel, ctx, expect, test } from './harness.ts'
import {
  assertCdS1AcrossCompaction,
  assertS7AfterCompaction,
  assertS7WithSnapshot,
  selectRequest,
} from './workspace-checks.ts'

const sessions = ctx.homes.main

interface OpenedEmbed {
  url: string
  navigations: () => number
}

async function withEmbedHost<T>(
  sessionPath: string,
  slug: string,
  run: (
    open: (
      page: Page,
      options?: { mode?: EmbedSourceMode; theme?: 'dark' | 'light'; lang?: string },
    ) => Promise<OpenedEmbed>,
  ) => Promise<T>,
): Promise<T> {
  const reportJson = await loadFixtureReportJson(sessionPath, slug)
  const host = await startEmbedHost(reportJson)
  try {
    return await run(async (page, options = {}) => {
      let navCount = 0
      const onNav = (frame: ReturnType<Page['mainFrame']>) => {
        if (frame === page.mainFrame()) {
          navCount += 1
        }
      }
      page.on('framenavigated', onNav)
      const params = new URLSearchParams({
        mode: options.mode ?? 'ready',
        theme: options.theme ?? 'dark',
        lang: options.lang ?? 'en',
      })
      const targetUrl = host.url(`/host/session?${params.toString()}#host-anchor`)
      await page.goto(targetUrl)
      return { url: targetUrl, navigations: () => navCount }
    })
  } finally {
    await host.close()
  }
}

test('DSH-2 / S7: Model saw after a compaction works inside <estela-workspace>', async ({ page }) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    await open(page)
    await expect(page.locator('#ws').getByTestId('ledger')).toBeVisible()
    await assertS7AfterCompaction(page)
  })
})

test('DSH-2 / S7: Model saw with prompt snapshots works inside <estela-workspace>', async ({ page }) => {
  await withEmbedHost(sessions.claudeSnapshot, 'snapshot', async open => {
    await open(page)
    await expect(page.locator('#ws').getByTestId('ledger')).toBeVisible()
    await assertS7WithSnapshot(page)
  })
})

test('DSH-2 / CD-S1: Compare across a compaction works inside <estela-workspace>', async ({ page }) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    await open(page)
    await expect(page.locator('#ws').getByTestId('ledger')).toBeVisible()
    await assertCdS1AcrossCompaction(page)
  })
})

test('DSH-11: host tokens, inherited styles, theme/lang attributes, and @property styles stay isolated', async ({
  page,
}) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    await open(page, { theme: 'dark', lang: 'en' })
    const ws = page.locator('#ws')
    await expect(ws.getByTestId('ledger')).toBeVisible()
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
    await expect(ws.getByRole('tab', { name: '模型所见' })).toBeVisible()

    const lightZh = await page.evaluate(() => {
      const el = document.getElementById('ws')!
      return {
        hostLang: document.documentElement.lang,
        hostTheme: document.documentElement.dataset.theme,
        background: getComputedStyle(el).backgroundColor,
        hasNav: el.shadowRoot!.querySelector('nav') !== null,
        hasH1: el.shadowRoot!.querySelector('h1') !== null,
        header: el.shadowRoot!.querySelector('[data-testid="embedded-header"]')?.textContent ?? '',
      }
    })

    expect(lightZh.hostLang).toBe('fr')
    expect(lightZh.hostTheme).toBe('host-page')
    expect(lightZh.background).toBe('rgb(251, 250, 248)')
    expect(lightZh.hasNav).toBe(false)
    expect(lightZh.hasH1).toBe(false)
    expect(lightZh.header).toContain('轮次')
    expect(lightZh.header).toContain('转到事件列表')

    // Explicit `--estela-host-*` tokens override the shadow palette while hostile `:root` vars stay ignored.
    const hostAdopted = await page.evaluate(() => {
      const el = document.getElementById('ws')!
      el.style.setProperty('--estela-host-bg', 'rgb(255, 255, 255)')
      const adopted = getComputedStyle(el).backgroundColor
      el.style.removeProperty('--estela-host-bg')
      const restored = getComputedStyle(el).backgroundColor
      return { adopted, restored }
    })
    expect(hostAdopted.adopted).toBe('rgb(255, 255, 255)')
    expect(hostAdopted.restored).toBe('rgb(251, 250, 248)')

    await page.evaluate(() => window.__embed!.disconnect())
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('style[data-estela-shared]').length)).toBe(0)
  })
})

test('embedded workspace: Go to events, inspector arrow keys, failed load, and Try again never reload or change the host URL', async ({
  page,
}) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    const opened = await open(page, { mode: 'fail-once' })
    const ws = page.locator('#ws')
    await expect(ws.getByTestId('load-error')).toBeVisible()
    await expect(ws.locator('a[href^="#"]')).toHaveCount(0)
    expect(page.url()).toBe(opened.url)
    expect(opened.navigations()).toBe(1)

    await ws.getByRole('button', { name: 'Try again' }).click()
    await expect(ws.getByTestId('ledger')).toBeVisible()
    expect(page.url()).toBe(opened.url)
    expect(opened.navigations()).toBe(1)

    // Embedded chrome omits TopBar, session h1, #/ links, theme/language switches, and Export report.
    await expect(ws.locator('nav')).toHaveCount(0)
    await expect(ws.locator('h1')).toHaveCount(0)
    await expect(ws.getByTestId('embedded-header')).toBeVisible()
    await expect(ws.locator('a[href^="#"]')).toHaveCount(0)
    await expect(ws.getByTestId('theme-switch')).toHaveCount(0)
    await expect(ws.getByTestId('language-switch')).toHaveCount(0)
    await expect(ws.getByTestId('export-report')).toHaveCount(0)

    // Go to events button and Ctrl+K shortcut focus the ledger inside the shadow root without touching location.href.
    await ws.getByRole('button', { name: 'Go to events', exact: true }).click()
    const focusedLedger = await page.evaluate(() =>
      document.getElementById('ws')?.shadowRoot?.activeElement?.getAttribute('data-testid'),
    )
    expect(focusedLedger).toBe('ledger')
    await ws.getByTestId('jump-to').focus()
    await page.keyboard.press('Control+k')
    const focusedByShortcut = await page.evaluate(() =>
      document.getElementById('ws')?.shadowRoot?.activeElement?.getAttribute('data-testid'),
    )
    expect(focusedByShortcut).toBe('ledger')
    expect(page.url()).toBe(opened.url)
    expect(opened.navigations()).toBe(1)

    // Arrow keys move focus across inspector tabs inside the shadow root without touching location.href.
    await selectRequest(page, '600 in')
    const inputTab = ws.getByRole('tab', { name: 'Input' })
    await inputTab.focus()
    await page.keyboard.press('ArrowRight')
    const focusedTab = await page.evaluate(() => document.getElementById('ws')?.shadowRoot?.activeElement?.id)
    expect(focusedTab).toBe('inspector-tab-output')
    await page.keyboard.press('End')
    const lastTab = await page.evaluate(() => document.getElementById('ws')?.shadowRoot?.activeElement?.id)
    expect(lastTab).toBe('inspector-tab-raw')

    expect(page.url()).toBe(opened.url)
    expect(await page.evaluate(() => location.href)).toBe(opened.url)
    expect(opened.navigations()).toBe(1)
  })
})

test('DSH-6: a throwing source stays contained inside the element and leaves the host page intact', async ({
  page,
}) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    const opened = await open(page, { mode: 'throw' })
    const ws = page.locator('#ws')
    const errorPanel = ws.getByTestId('load-error')
    await expect(errorPanel).toBeVisible()
    await expect(errorPanel).toContainText('Could not open this session')
    await expect(errorPanel).toContainText('channel exploded')
    await expect(ws.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByTestId('host-chrome')).toBeVisible()
    await expect(page.getByTestId('host-chrome')).toHaveText('Host page chrome')
    expect(page.url()).toBe(opened.url)
    expect(opened.navigations()).toBe(1)
  })
})

async function expectRetryRecoversAndReadsRaw(page: Page, opened: OpenedEmbed, expectedOpens: number) {
  const ws = page.locator('#ws')
  await ws.getByRole('button', { name: 'Try again' }).click()
  await expect(ws.getByTestId('ledger')).toBeVisible()
  await expect(page.getByTestId('host-chrome')).toBeVisible()

  // After recovery, reading an event must pass the new traceId from the reopened view.
  await selectRequest(page, '600 in')
  await ws.getByRole('tab', { name: 'Raw' }).click()
  await expect(activePanel(page)).toContainText('"type"')

  const state = await page.evaluate(() => ({
    openCalls: window.__embed!.openCalls(),
    lastEventTraceId: window.__embed!.eventTraceIds().at(-1),
    sameElement: window.__embed!.isSameElement(),
    sameSource: window.__embed!.isSameSource(),
  }))
  expect(state).toEqual({
    openCalls: expectedOpens,
    lastEventTraceId: `embed-trace-${expectedOpens}`,
    sameElement: true,
    sameSource: true,
  })
  expect(page.url()).toBe(opened.url)
  expect(opened.navigations()).toBe(1)
}

test('DSH-6: Try again recovers after a rejected open without replacing the element or source', async ({ page }) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    const opened = await open(page, { mode: 'fail-once' })
    const ws = page.locator('#ws')
    await expect(ws.getByTestId('load-error')).toContainText('temporary open failure')
    await expect(page.getByTestId('host-chrome')).toBeVisible()
    await expectRetryRecoversAndReadsRaw(page, opened, 2)
  })
})

test('DSH-6: a post-load event() failure offers Try again and reopens without replacing the element', async ({
  page,
}) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    const opened = await open(page, { mode: 'event-fail' })
    const ws = page.locator('#ws')
    await expect(ws.getByTestId('ledger')).toBeVisible()

    await selectRequest(page, '600 in')
    await ws.getByRole('tab', { name: 'Raw' }).click()

    const errorPanel = ws.getByTestId('load-error')
    await expect(errorPanel).toBeVisible()
    await expect(errorPanel).toContainText('transport closed')
    await expect(ws.locator('a[href^="#"]')).toHaveCount(0)
    await expect(page.getByTestId('host-chrome')).toBeVisible()
    await expectRetryRecoversAndReadsRaw(page, opened, 2)
  })
})

test('DSH-7: a slow source shows an indeterminate progressbar and enters the workspace once resolved', async ({
  page,
}) => {
  await withEmbedHost(sessions.claudeRising, 'rising', async open => {
    const opened = await open(page, { mode: 'slow' })
    const ws = page.locator('#ws')
    const loading = ws.getByTestId('loading')
    const progressbar = ws.getByRole('progressbar', { name: 'Opening session' })
    await expect(loading).toBeVisible()
    await expect(progressbar).toBeVisible()
    await expect(progressbar).not.toHaveAttribute('aria-valuenow')
    await expect(loading).toContainText('Opening session')
    await expect(loading).toContainText('Loading…')
    await expect(page.getByTestId('host-chrome')).toBeVisible()

    await page.evaluate(() => window.__embed!.resolveOpen())
    await expect(loading).toBeHidden()
    await expect(ws.getByTestId('ledger')).toBeVisible()
    expect(opened.navigations()).toBe(1)
  })
})
