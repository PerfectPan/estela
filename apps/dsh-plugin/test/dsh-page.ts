import { dismissNotices, type SmokeBrowser, type SmokeContext, type SmokePage } from './dsh-harness.ts'

export async function withDshPage<T>(
  browser: SmokeBrowser,
  url: string,
  fn: (page: SmokePage, ctx: SmokeContext) => Promise<T>,
  locale = 'en-US',
): Promise<T> {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale })
  const page = await ctx.newPage()
  try {
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1_000)
    await dismissNotices(page)
    return await fn(page, ctx)
  } finally {
    await ctx.close()
  }
}

export async function openSidebarSession(page: SmokePage, expectedEstelaTitle?: string): Promise<string[]> {
  const entries = page.getByText(/^(Untitled|未命名)$/)
  const count = await entries.count()
  for (let i = 0; i < count; i += 1) {
    await entries.nth(i).click({ timeout: 5_000 })
    await page.waitForTimeout(800)
    const tabs = await page.locator('[role=tab]').allTextContents()
    if (tabs.length === 0) {
      continue
    }
    if (!expectedEstelaTitle) {
      return tabs
    }
    if (!tabs.includes('Estela')) {
      continue
    }
    await page.getByRole('tab', { name: 'Estela' }).click({ timeout: 10_000 })
    await page.getByTestId('ledger').waitFor({ timeout: 15_000 })
    await page.waitForTimeout(300)
    const headerText = await page.evaluate(
      () => document.querySelector('estela-workspace')?.shadowRoot?.textContent ?? '',
    )
    if (headerText.includes(expectedEstelaTitle)) {
      return tabs
    }
  }
  throw new Error(
    `could not find started session ${expectedEstelaTitle ? `titled ${JSON.stringify(expectedEstelaTitle)}` : ''} among ${count} entries`,
  )
}

export async function readWorkspaceGeometry(page: SmokePage) {
  return page.evaluate(() => {
    const el = document.querySelector('estela-workspace')
    const shadow = el?.shadowRoot
    const ledger = shadow?.querySelector('[data-testid="ledger"]')
    const elRect = el?.getBoundingClientRect()
    let scroller = el?.parentElement ?? null
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement
    }
    const stickySibling = scroller
      ? Array.from(scroller.children).find(
          child => !child.contains(el) && getComputedStyle(child).position === 'sticky',
        )
      : undefined
    return {
      shadowText: shadow?.textContent ?? '',
      hasTimeline: shadow?.querySelector('[data-testid="timeline-plot"]') !== null,
      hasLedger: ledger !== null,
      hasInspector: shadow?.querySelector('[data-testid="inspector"]') !== null,
      hasError: shadow?.querySelector('[data-testid="error-panel"]') !== null,
      renderedRows: ledger?.querySelectorAll('[role=option]').length ?? 0,
      scrollHeight: ledger?.scrollHeight ?? 0,
      clientHeight: ledger?.clientHeight ?? 0,
      theme: el?.getAttribute('data-theme') ?? null,
      lang: el?.getAttribute('lang') ?? null,
      htmlDataTheme: document.documentElement.getAttribute('data-theme'),
      elBottom: elRect ? Math.round(elRect.bottom) : null,
      composerTop: stickySibling ? Math.round(stickySibling.getBoundingClientRect().top) : null,
    }
  })
}

export async function cookieHeaderOf(ctx: SmokeContext): Promise<string> {
  const cookies = await ctx.cookies()
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}
