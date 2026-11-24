import type { Browser } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { CHANNEL, DSH_VERSION } from '../src/contract/channel.ts'
import {
  createDshEnv,
  installDsh,
  launchChromium,
  listListeningPorts,
  packPlugin,
  ProcessTracker,
  repackWithEnginesDsh,
  rpcPost,
  runDshCli,
  startDshWeb,
  type RunningDsh,
} from './dsh-harness.ts'
import {
  assertProfileHasNoPlugin,
  assertWorkspaceHeightBounds,
  cookieHeaderOf,
  dismissNotices,
  measureColdLargeViewStall,
  openSidebarSession,
  parseOpenTraceId,
  parseRpcOk,
  parseTraceViewEvents,
  readHtmlAttrs,
  readWorkspaceGeometry,
  withDshPage,
  writeLightZhPatch,
} from './dsh-page.ts'
import { appendTurnFrame, seedSession, type SeededSession } from './seed-session.mjs'

const TARGET_DSH_VERSION = process.env.ESTELA_DSH_VERSION || DSH_VERSION
/**
 * Maximum allowed extra latency (ms) on dsh's own `POST /api/session/list` during a cold load of a
 * 500-repeat session (~200ms cold-load stall on Apple Silicon; 5x headroom for slower CI runners).
 */
const DSH_LOAD_STALL_MS = 1_000

describe('@rivus/dsh-estela smoke on dsh web', () => {
  const tracker = new ProcessTracker()
  let rootTmp = ''
  let dshBin = ''
  let tarball = ''
  let browser: Browser | undefined
  let activeDsh: RunningDsh | undefined

  let mainDshHome = ''
  let mainFakeHome = ''
  let mainWorkspace = ''
  let mainEnv: Record<string, string> = {}
  let primarySession: SeededSession | undefined

  beforeAll(async () => {
    rootTmp = await mkdtemp(join(tmpdir(), 'estela-dsh-smoke-'))
    const prefixDir = join(rootTmp, 'dsh-prefix')
    const npmHomeDir = join(rootTmp, 'npm-home')
    const packDir = join(rootTmp, 'pack')
    mainDshHome = join(rootTmp, 'dsh-home')
    mainFakeHome = join(rootTmp, 'fake-home')
    mainWorkspace = join(rootTmp, 'workspace')
    await Promise.all([
      mkdir(mainDshHome, { recursive: true }),
      mkdir(mainFakeHome, { recursive: true }),
      mkdir(mainWorkspace, { recursive: true }),
    ])
    mainEnv = createDshEnv(mainDshHome, mainFakeHome)

    // Register the browser handle as soon as launch resolves and settle every task before throwing
    // so `afterAll` can close the browser and remove `rootTmp` cleanly on partial startup failure.
    const [dshResult, packResult, browserResult] = await Promise.allSettled([
      installDsh(prefixDir, TARGET_DSH_VERSION, npmHomeDir, tracker),
      packPlugin(packDir, npmHomeDir, tracker),
      launchChromium().then(launched => {
        browser = launched
        return launched
      }),
    ])
    if (dshResult.status === 'rejected') {
      throw dshResult.reason
    }
    if (packResult.status === 'rejected') {
      throw packResult.reason
    }
    if (browserResult.status === 'rejected') {
      throw browserResult.reason
    }
    dshBin = dshResult.value
    tarball = packResult.value

    const install = await runDshCli(dshBin, ['plugin', '--profile', 'web', 'add', tarball], mainEnv, tracker)
    if (install.exitCode !== 0) {
      throw new Error(`dsh plugin add failed (exit ${install.exitCode}):\n${install.stdout}${install.stderr}`)
    }

    primarySession = seedSession({
      home: mainDshHome,
      cwd: mainWorkspace,
      title: 'Estela primary smoke',
      userText: `inspect secret path ${mainFakeHome}/projects/app`,
    })

    activeDsh = await startDshWeb(dshBin, mainEnv, tracker)
  })

  afterAll(async () => {
    activeDsh = undefined
    if (browser) {
      await browser.close()
      browser = undefined
    }
    await tracker.cleanupAll()
    if (rootTmp && process.env.ESTELA_SMOKE_KEEP !== '1') {
      await rm(rootTmp, { recursive: true, force: true })
    }
  })

  it('DSH-1, DSH-2, DSH-3, DSH-10, DSH-14: renders Estela workspace, redacts fake home, bounds height, and enforces channel admission', async () => {
    await withDshPage(browser!, activeDsh!.url, async (page, ctx) => {
      const consoleErrors: string[] = []
      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })
      page.on('pageerror', error => {
        consoleErrors.push(error.message)
      })

      // DSH-3: a blank session shows no View tabs, opens the slash menu with built-in commands, and has no `/estela`.
      await page
        .getByRole('button', { name: /new session/i })
        .first()
        .click({ timeout: 10_000 })
      const composerBox = page.locator('[role=textbox], [contenteditable="true"]').first()
      await composerBox.waitFor({ state: 'visible', timeout: 10_000 })
      expect(await page.locator('[role=tab]').count()).toBe(0)
      await composerBox.click({ timeout: 5_000 })
      await page.keyboard.type('/')
      const slashMenu = page.locator('[role=listbox]').first()
      await slashMenu.waitFor({ state: 'visible', timeout: 5_000 })
      const slashOptions = await slashMenu.locator('[role=option]').allTextContents()
      expect(slashOptions.length).toBeGreaterThan(0)
      expect(slashOptions.some(text => /compact|goal|feedback/i.test(text))).toBe(true)
      expect(slashOptions.some(text => /estela/i.test(text))).toBe(false)
      await page.keyboard.press('Escape')

      // DSH-1: started seeded session shows Estela tab after Trajectory.
      const tabs = await openSidebarSession(page, primarySession!.id, { selectEstela: true })
      expect(tabs).toContain('Chat')
      expect(tabs).toContain('Trajectory')
      expect(tabs).toContain('Estela')
      expect(tabs.indexOf('Estela')).toBeGreaterThan(tabs.indexOf('Trajectory'))

      // DSH-2 + T25 + DSH-10: verify workspace, full available height, redaction, and untouched <html>.
      const geometry = await readWorkspaceGeometry(page)
      expect(geometry.hasTimeline).toBe(true)
      expect(geometry.hasLedger).toBe(true)
      expect(geometry.hasInspector).toBe(true)
      expect(geometry.shadowText.includes('Export report')).toBe(false)
      expect(geometry.hasError).toBe(false)
      expect(geometry.shadowText.includes(mainFakeHome)).toBe(false)
      expect(geometry.shadowText.includes('~/projects/app')).toBe(true)
      expect(geometry.htmlDataTheme).toBeNull()
      assertWorkspaceHeightBounds(geometry)

      // Click a request row and confirm all 5 inspector tabs render cleanly.
      await page.locator('estela-workspace [data-testid="ledger"] [role=option]').nth(1).click({ timeout: 5_000 })
      await page.locator('estela-workspace [data-testid="inspector"] [role=tab]').first().waitFor({ timeout: 5_000 })
      const inspectorTabs = await page
        .locator('estela-workspace [data-testid="inspector"] [role=tab]')
        .allTextContents()
      expect(inspectorTabs.join(' ')).toMatch(/Input.*Output.*Model saw.*Compare.*Raw/)

      // DSH-10 (UI Raw tab): select the user entry row carrying the fake HOME path and verify Raw redaction.
      const secretRow = page
        .locator('estela-workspace [data-testid="ledger"] [role=option]')
        .filter({ hasText: '~/projects/app', hasNot: page.locator('[data-testid="turn-totals"]') })
        .first()
      await secretRow.click({ timeout: 5_000 })
      await page
        .locator('estela-workspace [data-testid="inspector"] [role=tab]')
        .filter({ hasText: 'Raw' })
        .first()
        .click({ timeout: 5_000 })
      const rawInspector = page.locator('estela-workspace [data-testid="inspector"]')
      await expect
        .poll(async () => (await rawInspector.textContent()) ?? '', { timeout: 10_000 })
        .toContain('~/projects/app')
      expect((await rawInspector.textContent()) ?? '').not.toContain(mainFakeHome)
      expect(consoleErrors).toEqual([])

      // DSH-14: channel admission checks (no cookie -> 401; foreign Origin -> 403; owner cookie -> 200).
      const cookieHeader = await cookieHeaderOf(ctx)
      const noCookie = await rpcPost(activeDsh!.port, CHANNEL, 'session/open', { sessionId: primarySession!.id })
      expect(noCookie.status).toBe(401)
      const crossOrigin = await rpcPost(
        activeDsh!.port,
        CHANNEL,
        'session/open',
        { sessionId: primarySession!.id },
        { cookie: cookieHeader, headers: { origin: 'http://evil.example' } },
      )
      expect(crossOrigin.status).toBe(403)
      const ownerCall = await rpcPost(
        activeDsh!.port,
        CHANNEL,
        'session/open',
        { sessionId: primarySession!.id },
        { cookie: cookieHeader, headers: { origin: `http://127.0.0.1:${activeDsh!.port}` } },
      )
      const traceId = parseOpenTraceId(ownerCall)

      // DSH-10 (RPC trace/event): fetch the exact event containing the fake HOME path and verify redaction.
      const viewRes = await rpcPost(activeDsh!.port, CHANNEL, 'trace/view', { traceId }, { cookie: cookieHeader })
      expect(viewRes.text).not.toContain(mainFakeHome)
      const secretEvent = parseTraceViewEvents(viewRes).find(event => JSON.stringify(event).includes('~/projects/app'))
      expect(secretEvent).toBeDefined()
      const eventRes = await rpcPost(
        activeDsh!.port,
        CHANNEL,
        'trace/event',
        { traceId, id: secretEvent!.id },
        { cookie: cookieHeader },
      )
      parseRpcOk(eventRes)
      expect(eventRes.text).toContain('~/projects/app')
      expect(eventRes.text).not.toContain(mainFakeHome)
    })
  })

  it('DSH-6: contains transport failure inside the Estela View and recovers via Try again without remounting', async () => {
    await withDshPage(browser!, activeDsh!.url, async page => {
      await openSidebarSession(page, primarySession!.id)

      await page.route('**/estela/**', async route => {
        await route.abort('failed')
      })

      await page.getByRole('tab', { name: 'Estela' }).click({ timeout: 10_000 })
      await page.locator('estela-workspace [data-testid="load-error"]').waitFor({ state: 'visible', timeout: 10_000 })
      await page.getByRole('button', { name: 'Try again' }).waitFor({ state: 'visible', timeout: 10_000 })

      // Other dsh Views remain usable and still render the seeded session's content.
      await page.getByRole('tab', { name: 'Trajectory' }).click({ timeout: 5_000 })
      const trajectoryPanel = page.locator('[data-conversation-composer-overlay]').first()
      await trajectoryPanel.waitFor({ state: 'visible', timeout: 10_000 })
      await expect
        .poll(async () => (await trajectoryPanel.textContent()) ?? '', { timeout: 10_000 })
        .toContain('inspect secret path')

      await page.getByRole('tab', { name: 'Estela' }).click({ timeout: 5_000 })
      await page.getByRole('button', { name: 'Try again' }).waitFor({ state: 'visible', timeout: 10_000 })

      await page.evaluate(() => {
        document.querySelector('estela-workspace')?.setAttribute('data-smoke-instance', 'kept')
      })

      await page.unroute('**/estela/**')
      await page.getByRole('button', { name: 'Try again' }).click({ timeout: 5_000 })
      await page.getByTestId('ledger').waitFor({ state: 'visible', timeout: 15_000 })

      const instanceTag = await page.evaluate(() =>
        document.querySelector('estela-workspace')?.getAttribute('data-smoke-instance'),
      )
      expect(instanceTag).toBe('kept')
      expect(await page.locator('estela-workspace [data-testid="load-error"]').count()).toBe(0)
    })
  })

  it('DSH-9: keeps snapshot steady after appending a frame and shows the new turn after page reload', async () => {
    const appendedMarker = 'DSH9_APPENDED_MARKER_TEXT'
    await withDshPage(browser!, activeDsh!.url, async page => {
      await openSidebarSession(page, primarySession!.id, { selectEstela: true })
      const before = await readWorkspaceGeometry(page)
      expect(before.hasError).toBe(false)
      expect(before.turns).toBe('2')
      expect(before.requests).toBe('2')
      expect(before.renderedRows).toBeGreaterThan(0)
      expect(before.lastRowText).not.toBeNull()
      expect(before.shadowText).not.toContain(appendedMarker)

      appendTurnFrame(primarySession!.logPath, {
        startSeq: primarySession!.lastSeq + 1,
        turn: primarySession!.lastTurn + 1,
        userText: appendedMarker,
      })
      await page.waitForTimeout(600)

      const afterAppend = await readWorkspaceGeometry(page)
      expect(afterAppend.hasError).toBe(false)
      expect(afterAppend.turns).toBe(before.turns)
      expect(afterAppend.requests).toBe(before.requests)
      expect(afterAppend.renderedRows).toBe(before.renderedRows)
      expect(afterAppend.lastRowText).toBe(before.lastRowText)
      expect(afterAppend.shadowText).not.toContain(appendedMarker)

      await page.reload({ waitUntil: 'networkidle' })
      await dismissNotices(page)
      await openSidebarSession(page, primarySession!.id, { selectEstela: true })

      await page.evaluate(() => {
        const ledger = document.querySelector('estela-workspace')?.shadowRoot?.querySelector('[data-testid="ledger"]')
        if (ledger) {
          ledger.scrollTop = ledger.scrollHeight
        }
      })
      await page.waitForTimeout(300)
      const reloaded = await readWorkspaceGeometry(page)
      expect(reloaded.hasError).toBe(false)
      expect(reloaded.turns).toBe('3')
      expect(reloaded.requests).toBe('3')
      expect(reloaded.shadowText).toContain(appendedMarker)
    })
  })

  it('DSH-7: loads a large session cold with virtualized ledger while keeping dsh session/list stall within budget', async () => {
    // Restart on a fresh `dsh` process after seeding a brand-new large session so `trace/view` is a guaranteed cold load.
    await activeDsh!.stop()
    activeDsh = undefined
    const largeSession = seedSession({
      home: mainDshHome,
      cwd: mainWorkspace,
      title: 'Estela large smoke',
      userText: 'large session marker',
      repeats: 500,
    })
    activeDsh = await startDshWeb(dshBin, mainEnv, tracker)

    await withDshPage(browser!, activeDsh.url, async (page, ctx) => {
      const cookieHeader = await cookieHeaderOf(ctx)
      const measured = await measureColdLargeViewStall(activeDsh!.port, largeSession.id, cookieHeader)
      process.stdout.write(
        `DSH-7 stall: baseline=${measured.baselineMs.toFixed(1)}ms maxConcurrent=${measured.maxConcurrentMs.toFixed(1)}ms stall=${measured.stallMs.toFixed(1)}ms probes=${measured.probes} viewLoad=${measured.viewLoadMs.toFixed(1)}ms viewBytes=${measured.viewBytes} budget=${DSH_LOAD_STALL_MS}ms\n`,
      )
      expect(measured.stallMs).toBeLessThan(DSH_LOAD_STALL_MS)

      await openSidebarSession(page, largeSession.id, { selectEstela: true })
      const layout = await readWorkspaceGeometry(page)
      expect(layout.hasError).toBe(false)
      expect(layout.renderedRows).toBeGreaterThan(0)
      expect(layout.renderedRows).toBeLessThan(100)
      expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight * 3)
      assertWorkspaceHeightBounds(layout)
    })
  })

  it('DSH-11: follows light theme and Chinese locale from cordis.patch.yml over an English dark browser without writing <html>', async () => {
    await activeDsh!.stop()
    activeDsh = undefined
    await writeLightZhPatch(mainDshHome)

    activeDsh = await startDshWeb(dshBin, mainEnv, tracker)
    await withDshPage(
      browser!,
      activeDsh.url,
      async page => {
        await openSidebarSession(page, primarySession!.id)
        const htmlBefore = await readHtmlAttrs(page)
        await page.getByRole('tab', { name: 'Estela' }).click({ timeout: 10_000 })
        await page.getByTestId('ledger').waitFor({ state: 'visible', timeout: 15_000 })

        const state = await readWorkspaceGeometry(page)
        expect(state.theme).toBe('light')
        expect(state.lang).toBe('zh-CN')
        expect(state.htmlLang).toBe(htmlBefore.lang)
        expect(state.htmlDataTheme).toBe(htmlBefore.dataTheme)
        expect(state.htmlStyle).toBe(htmlBefore.style)
        expect(
          state.shadowText.includes('会话')
            || state.shadowText.includes('时间线')
            || state.shadowText.includes('全部事件'),
        ).toBe(true)
        expect(state.shadowText).toContain('inspect secret path')
      },
      { locale: 'en-US', colorScheme: 'dark' },
    )
  })

  it('DSH-12: uninstalling removes the tab, returns 405, leaves no sockets or files, and reinstalling into the same profile restores it', async () => {
    try {
      await withDshPage(browser!, activeDsh!.url, async (page, ctx) => {
        await openSidebarSession(page, primarySession!.id)
        await page.getByRole('tab', { name: 'Estela' }).waitFor({ state: 'visible', timeout: 10_000 })

        const cookieHeader = await cookieHeaderOf(ctx)
        const portsBefore = await listListeningPorts(activeDsh!.pid)
        expect(portsBefore.length).toBeGreaterThan(0)

        const removed = await runDshCli(
          dshBin,
          ['plugin', '--profile', 'web', 'remove', '@rivus/dsh-estela'],
          mainEnv,
          tracker,
        )
        expect(removed.exitCode).toBe(0)

        await page.getByRole('tab', { name: 'Estela' }).waitFor({ state: 'detached', timeout: 15_000 })

        const afterCall = await rpcPost(
          activeDsh!.port,
          CHANNEL,
          'session/open',
          { sessionId: primarySession!.id },
          { cookie: cookieHeader },
        )
        expect(afterCall.status).toBe(405)
        expect(await listListeningPorts(activeDsh!.pid)).toEqual(portsBefore)
        await assertProfileHasNoPlugin(mainDshHome)

        // Reinstall into the same profile and verify the Estela tab returns and loads cleanly.
        const reinstalled = await runDshCli(dshBin, ['plugin', '--profile', 'web', 'add', tarball], mainEnv, tracker)
        expect(reinstalled.exitCode).toBe(0)
      })

      await activeDsh!.stop()
      activeDsh = await startDshWeb(dshBin, mainEnv, tracker)

      await withDshPage(browser!, activeDsh.url, async page => {
        const tabs = await openSidebarSession(page, primarySession!.id, { selectEstela: true })
        expect(tabs).toContain('Estela')
        const state = await readWorkspaceGeometry(page)
        expect(state.hasLedger).toBe(true)
        expect(state.hasError).toBe(false)
      })
    } finally {
      if (activeDsh) {
        await activeDsh.stop()
        activeDsh = undefined
      }
    }
  })

  it('DSH-13: refuses installing an incompatible tarball cleanly to stderr and disables a pre-installed incompatible copy at startup', async () => {
    const incompatDir = join(rootTmp, 'dsh-incompat')
    const incompatHome = join(incompatDir, 'dsh-home')
    const incompatFakeHome = join(incompatDir, 'fake-home')
    const incompatWorkspace = join(incompatDir, 'workspace')
    await Promise.all([
      mkdir(incompatHome, { recursive: true }),
      mkdir(incompatFakeHome, { recursive: true }),
      mkdir(incompatWorkspace, { recursive: true }),
    ])
    const incompatEnv = createDshEnv(incompatHome, incompatFakeHome)

    const badTarball = await repackWithEnginesDsh(tarball, '>=99', incompatDir, tracker)
    const refused = await runDshCli(dshBin, ['plugin', '--profile', 'web', 'add', badTarball], incompatEnv, tracker)
    expect(refused.exitCode).toBe(1)
    expect(refused.stderr).toMatch(/incompatible/i)
    expect(refused.stderr).toContain('allow-version')
    await assertProfileHasNoPlugin(incompatHome)

    const installed = await runDshCli(dshBin, ['plugin', '--profile', 'web', 'add', tarball], incompatEnv, tracker)
    expect(installed.exitCode).toBe(0)

    const incompatSession = seedSession({
      home: incompatHome,
      cwd: incompatWorkspace,
      title: 'Incompat startup check',
    })

    const installedPkgPath = join(incompatHome, 'profiles/web/node_modules/@rivus/dsh-estela/package.json')
    const installedPkg = z.parse(
      z.looseObject({ engines: z.looseObject({ dsh: z.string() }) }),
      JSON.parse(await readFile(installedPkgPath, 'utf8')),
    )
    installedPkg.engines.dsh = '>=99'
    await writeFile(installedPkgPath, `${JSON.stringify(installedPkg, null, 2)}\n`, 'utf8')

    const incompatDsh = await startDshWeb(dshBin, incompatEnv, tracker)
    try {
      await withDshPage(browser!, incompatDsh.url, async page => {
        const tabs = await openSidebarSession(page, incompatSession.id)
        expect(tabs).toContain('Chat')
        expect(tabs).toContain('Trajectory')
        expect(tabs).not.toContain('Estela')
        expect(incompatDsh.output()).toMatch(/disabling profile plugin/i)
      })
    } finally {
      await incompatDsh.stop()
    }
  })
})
