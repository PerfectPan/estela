import type { Browser, BrowserContext, Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from 'vite-plus/test'
import * as z from 'zod/mini'
import { CHANNEL } from '../src/contract/channel.ts'
import { rpcPost, type HttpResponse } from './dsh-harness.ts'

const rpcEnvelopeSchema = z.object({
  result: z.object({
    ok: z.boolean(),
    value: z.optional(z.unknown()),
  }),
})
const openValueSchema = z.object({ traceId: z.string() })
const traceViewValueSchema = z.object({
  trace: z.object({
    events: z.array(z.looseObject({ id: z.string(), kind: z.string() })),
  }),
})
const profilePkgSchema = z.object({
  dependencies: z.optional(z.record(z.string(), z.string())),
  dsh: z.object({
    profile: z.object({
      bundles: z.array(z.string()),
    }),
  }),
})

export function parseRpcOk(res: HttpResponse): unknown {
  expect(res.status).toBe(200)
  const envelope = z.parse(rpcEnvelopeSchema, JSON.parse(res.text))
  expect(envelope.result.ok).toBe(true)
  return envelope.result.value
}

export function parseOpenTraceId(res: HttpResponse): string {
  return z.parse(openValueSchema, parseRpcOk(res)).traceId
}

export function parseTraceViewEvents(res: HttpResponse) {
  return z.parse(traceViewValueSchema, parseRpcOk(res)).trace.events
}

export async function assertProfileHasNoPlugin(dshHome: string): Promise<void> {
  expect(existsSync(join(dshHome, 'profiles/web/node_modules/@rivus/dsh-estela'))).toBe(false)
  const pkgPath = join(dshHome, 'profiles/web/package.json')
  if (existsSync(pkgPath)) {
    const pkg = z.parse(profilePkgSchema, JSON.parse(await readFile(pkgPath, 'utf8')))
    expect(pkg.dependencies?.['@rivus/dsh-estela']).toBeUndefined()
    expect(pkg.dsh.profile.bundles).not.toContain('@rivus/dsh-estela')
  }
}

export async function measureColdLargeViewStall(port: number, sessionId: string, cookie: string) {
  const baselineLatencies: number[] = []
  for (let i = 0; i < 3; i += 1) {
    const res = await rpcPost(port, '/api', 'session/list', { args: { _request: {} } }, { cookie })
    parseRpcOk(res)
    baselineLatencies.push(res.ms)
  }
  const baselineMs = Math.min(...baselineLatencies)
  const traceId = parseOpenTraceId(await rpcPost(port, CHANNEL, 'session/open', { sessionId }, { cookie }))

  // Probe continuously from the start of the cold `trace/view` call until it returns.
  let viewSettled = false
  const probeLatencies: number[] = []
  const loadPromise = rpcPost(port, CHANNEL, 'trace/view', { traceId }, { cookie }).finally(() => {
    viewSettled = true
  })
  const runProbeLoop = async (): Promise<void> => {
    do {
      const probe = await rpcPost(port, '/api', 'session/list', { args: { _request: {} } }, { cookie })
      parseRpcOk(probe)
      probeLatencies.push(probe.ms)
    } while (!viewSettled)
  }

  const [viewRes] = await Promise.all([loadPromise, runProbeLoop(), runProbeLoop()])
  const events = parseTraceViewEvents(viewRes)
  expect(events.length).toBeGreaterThanOrEqual(5_000)
  expect(probeLatencies.length).toBeGreaterThanOrEqual(2)
  const maxConcurrentMs = Math.max(...probeLatencies)
  return {
    baselineMs,
    maxConcurrentMs,
    stallMs: Math.max(0, maxConcurrentMs - baselineMs),
    probes: probeLatencies.length,
    viewLoadMs: viewRes.ms,
    viewBytes: viewRes.text.length,
  }
}

export async function dismissNotices(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /continue|继续/i })
    .first()
    .click({ force: true, timeout: 4_000 })
    .catch(() => {})
  await page.waitForTimeout(400)
  const signIn = page.locator('[role=presentation]').filter({ hasText: /get started|开始使用/i })
  if ((await signIn.count()) > 0) {
    await signIn
      .first()
      .locator('button')
      .first()
      .click({ force: true, timeout: 4_000 })
      .catch(() => {})
    await page.waitForTimeout(400)
  }
}

export interface DshPageOptions {
  readonly locale?: string
  readonly colorScheme?: 'light' | 'dark'
}

export async function withDshPage<T>(
  browser: Browser,
  url: string,
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  options: DshPageOptions = {},
): Promise<T> {
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: options.locale ?? 'en-US',
    colorScheme: options.colorScheme ?? 'light',
  })
  const page = await ctx.newPage()
  try {
    await page.goto(url, { waitUntil: 'networkidle' })
    await dismissNotices(page)
    return await fn(page, ctx)
  } finally {
    await ctx.close()
  }
}

export async function openSidebarSession(
  page: Page,
  sessionId: string,
  options: { selectEstela?: boolean } = {},
): Promise<string[]> {
  const row = page.locator(`[data-row-key="session:${sessionId}"]`).first()
  await row.waitFor({ state: 'visible', timeout: 15_000 })
  await row.click({ timeout: 5_000 })
  await page.locator('[role=tab]').first().waitFor({ state: 'visible', timeout: 10_000 })
  const tabs = await page.locator('[role=tab]').allTextContents()
  if (options.selectEstela) {
    await page.getByRole('tab', { name: 'Estela' }).click({ timeout: 10_000 })
    await page.getByTestId('ledger').waitFor({ state: 'visible', timeout: 15_000 })
  }
  return tabs
}

export interface HtmlAttrs {
  readonly lang: string | null
  readonly dataTheme: string | null
  readonly style: string | null
}

export async function readHtmlAttrs(page: Page): Promise<HtmlAttrs> {
  return page.evaluate(() => ({
    lang: document.documentElement.getAttribute('lang'),
    dataTheme: document.documentElement.getAttribute('data-theme'),
    style: document.documentElement.getAttribute('style'),
  }))
}

export interface WorkspaceGeometry {
  readonly shadowText: string
  readonly hasTopBar: boolean
  readonly hasHeading: boolean
  readonly hasEmbeddedHeader: boolean
  readonly hasJumpButton: boolean
  readonly hasTimeline: boolean
  readonly hasLedger: boolean
  readonly hasInspector: boolean
  readonly hasError: boolean
  readonly renderedRows: number
  readonly lastRowText: string | null
  readonly turns: string | null
  readonly requests: string | null
  readonly scrollHeight: number
  readonly clientHeight: number
  readonly theme: string | null
  readonly lang: string | null
  readonly background: string | null
  readonly bodyBackground: string
  readonly htmlLang: string | null
  readonly htmlDataTheme: string | null
  readonly htmlStyle: string | null
  readonly scrollerClientHeight: number | null
  readonly elBottom: number | null
  readonly elHeight: number | null
  readonly composerTop: number | null
  readonly composerHeight: number | null
}

export async function readWorkspaceGeometry(page: Page): Promise<WorkspaceGeometry> {
  return page.evaluate(() => {
    const el = document.querySelector('estela-workspace')
    const shadow = el?.shadowRoot
    const ledger = shadow?.querySelector('[data-testid="ledger"]')
    const rows = ledger ? Array.from(ledger.querySelectorAll('[role=option]')) : []
    const metricEntries = Array.from(shadow?.querySelectorAll('section dl > div') ?? []).map(item => ({
      label: item.querySelector('dt')?.textContent.trim() ?? '',
      value: item.querySelector('dd')?.textContent.trim() ?? '',
    }))
    const metricValue = (pattern: RegExp): string | null =>
      metricEntries.find(entry => pattern.test(entry.label))?.value ?? null

    const elRect = el?.getBoundingClientRect()
    let scroller = el?.parentElement ?? null
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement
    }
    const textbox = scroller?.querySelector('[role="textbox"], [contenteditable="true"]') ?? null
    const composerEl = scroller
      ? (Array.from(scroller.children).find(
          child =>
            !child.contains(el) && (child.contains(textbox) || /sticky|fixed/.test(getComputedStyle(child).position)),
        ) ?? null)
      : null
    const composerRect = composerEl?.getBoundingClientRect()

    return {
      shadowText: shadow?.textContent ?? '',
      hasTopBar: shadow?.querySelector('nav') !== null,
      hasHeading: shadow?.querySelector('h1') !== null,
      hasEmbeddedHeader: shadow?.querySelector('[data-testid="embedded-header"]') !== null,
      hasJumpButton: shadow?.querySelector('[data-testid="jump-to"]') !== null,
      hasTimeline: shadow?.querySelector('[data-testid="timeline-plot"]') !== null,
      hasLedger: ledger !== null,
      hasInspector: shadow?.querySelector('[data-testid="inspector"]') !== null,
      hasError: shadow?.querySelector('[data-testid="load-error"]') !== null,
      renderedRows: rows.length,
      lastRowText: rows.at(-1)?.textContent.trim() ?? null,
      turns: metricValue(/^(Turns?|轮次)$/i),
      requests: metricValue(/^(Requests?|请求)$/i),
      scrollHeight: ledger?.scrollHeight ?? 0,
      clientHeight: ledger?.clientHeight ?? 0,
      theme: el?.getAttribute('data-theme') ?? null,
      lang: el?.getAttribute('lang') ?? null,
      background: el ? getComputedStyle(el).backgroundColor : null,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      htmlLang: document.documentElement.getAttribute('lang'),
      htmlDataTheme: document.documentElement.getAttribute('data-theme'),
      htmlStyle: document.documentElement.getAttribute('style'),
      scrollerClientHeight: scroller ? scroller.clientHeight : null,
      elBottom: elRect ? Math.round(elRect.bottom) : null,
      elHeight: elRect ? Math.round(elRect.height) : null,
      composerTop: composerRect ? Math.round(composerRect.top) : null,
      composerHeight: composerRect ? Math.round(composerRect.height) : null,
    }
  })
}

export function assertWorkspaceHeightBounds(geometry: WorkspaceGeometry): void {
  expect(geometry.scrollerClientHeight).not.toBeNull()
  expect(geometry.composerTop).not.toBeNull()
  expect(geometry.composerHeight).not.toBeNull()
  expect(geometry.elBottom).not.toBeNull()
  expect(geometry.elHeight).not.toBeNull()
  expect(geometry.elBottom!).toBeLessThanOrEqual(geometry.composerTop! + 1)
  expect(geometry.elHeight!).toBeGreaterThanOrEqual(geometry.scrollerClientHeight! - geometry.composerHeight! - 8)
}

export async function assertEmbeddedChromeAndJump(page: Page, geometry: WorkspaceGeometry): Promise<void> {
  expect(geometry.hasTopBar).toBe(false)
  expect(geometry.hasHeading).toBe(false)
  expect(geometry.hasEmbeddedHeader).toBe(true)
  expect(geometry.hasJumpButton).toBe(true)
  expect(geometry.background).toBe(geometry.bodyBackground)

  const readFocusedTestId = () =>
    page.evaluate(() =>
      document.querySelector('estela-workspace')?.shadowRoot?.activeElement?.getAttribute('data-testid'),
    )
  await page.locator('estela-workspace [data-testid="jump-to"]').click({ timeout: 5_000 })
  expect(await readFocusedTestId()).toBe('ledger')
  await page.locator('estela-workspace [data-testid="jump-to"]').focus()
  await page.keyboard.press('Control+k')
  expect(await readFocusedTestId()).toBe('ledger')
}

export async function writeLightZhPatch(dshHome: string): Promise<void> {
  await writeFile(
    join(dshHome, 'profiles/web/cordis.patch.yml'),
    [
      '- id: ui-settings-general',
      '  name: "@deepseek-ai/dsh-client-ui-settings-general"',
      '  config:',
      '    welcomeNoticeVersion: 2026-09-28.1',
      '- id: ui-theme',
      '  name: "@deepseek-ai/dsh-client-ui-theme"',
      '  config:',
      '    preference: light',
      '- id: locale',
      '  name: "@deepseek-ai/dsh-client-locale"',
      '  config:',
      '    preference: zh',
      '',
    ].join('\n'),
    'utf8',
  )
}

export async function cookieHeaderOf(ctx: BrowserContext): Promise<string> {
  const cookies = await ctx.cookies()
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}
