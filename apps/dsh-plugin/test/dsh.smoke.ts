import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import * as z from 'zod/mini'
import { CHANNEL, DSH_VERSION } from '../src/contract/channel.ts'
import {
  assertNoListeningPorts,
  createDshEnv,
  dismissNotices,
  installDsh,
  launchChromium,
  listListeningPorts,
  packPlugin,
  readWorkspacePath,
  repackWithEnginesDsh,
  rpcPost,
  runDshCli,
  startDshWeb,
  type RunningDsh,
  type SmokeBrowser,
} from './dsh-harness.ts'
import { cookieHeaderOf, openSidebarSession, readWorkspaceGeometry, withDshPage } from './dsh-page.ts'
import { appendTurnFrame, seedSession, type SeededSession } from './seed-session.mjs'

const TARGET_DSH_VERSION = process.env.ESTELA_DSH_VERSION || DSH_VERSION
/** Maximum allowed extra latency (ms) on dsh's own `POST /api/session/list` while Estela loads a large session (DSH-7). */
const DSH_LOAD_STALL_MS = 250

const rpcEnvelopeSchema = z.object({
  result: z.object({
    ok: z.boolean(),
    value: z.optional(z.unknown()),
  }),
})
const openValueSchema = z.object({ traceId: z.string() })
const profilePkgSchema = z.object({
  dependencies: z.optional(z.record(z.string(), z.string())),
  dsh: z.object({
    profile: z.object({
      bundles: z.array(z.string()),
    }),
  }),
})

describe('@rivus/dsh-estela smoke on dsh web', () => {
  const trackedPids = new Set<number>()
  let rootTmp = ''
  let dshBin = ''
  let tarball = ''
  let browser: SmokeBrowser | undefined
  let activeDsh: RunningDsh | undefined

  let mainDshHome = ''
  let mainFakeHome = ''
  let mainEnv: Record<string, string> = {}
  let primarySession: SeededSession | undefined
  let largeSession: SeededSession | undefined

  beforeAll(async () => {
    rootTmp = await mkdtemp(join(tmpdir(), 'estela-dsh-smoke-'))
    const prefixDir = join(rootTmp, 'dsh-prefix')
    const packDir = join(rootTmp, 'pack')
    mainDshHome = join(rootTmp, 'dsh-home')
    mainFakeHome = join(rootTmp, 'fake-home')
    await mkdir(mainDshHome, { recursive: true })
    await mkdir(mainFakeHome, { recursive: true })
    mainEnv = createDshEnv(mainDshHome, mainFakeHome)

    const [installedBin, packedTarball, launchedBrowser] = await Promise.all([
      installDsh(prefixDir, TARGET_DSH_VERSION),
      packPlugin(packDir),
      launchChromium(),
    ])
    dshBin = installedBin
    tarball = packedTarball
    browser = launchedBrowser

    const install = await runDshCli(dshBin, ['plugin', '--profile', 'web', 'add', tarball], mainEnv)
    if (install.exitCode !== 0) {
      throw new Error(`dsh plugin add failed (exit ${install.exitCode}):\n${install.stdout}${install.stderr}`)
    }

    const initDsh = await startDshWeb(dshBin, mainEnv, trackedPids)
    try {
      await withDshPage(browser, initDsh.url, async () => {})
    } finally {
      await initDsh.stop()
    }

    const workspacePath = await readWorkspacePath(mainDshHome)
    primarySession = seedSession({
      home: mainDshHome,
      cwd: workspacePath,
      title: 'Estela primary smoke',
      userText: `inspect secret path ${mainFakeHome}/projects/app`,
    })
    largeSession = seedSession({
      home: mainDshHome,
      cwd: workspacePath,
      title: 'Estela large smoke',
      userText: 'large session marker',
      repeats: 500,
    })

    activeDsh = await startDshWeb(dshBin, mainEnv, trackedPids)
  })

  afterAll(async () => {
    if (activeDsh) {
      await activeDsh.stop()
      activeDsh = undefined
    }
    if (browser) {
      await browser.close()
      browser = undefined
    }
    if (rootTmp && process.env.ESTELA_SMOKE_KEEP !== '1') {
      await rm(rootTmp, { recursive: true, force: true })
    }
    await assertNoListeningPorts(trackedPids)
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

      // DSH-3: a blank session shows no View tabs and no `/estela` slash command.
      await page
        .getByRole('button', { name: /new session/i })
        .first()
        .click({ timeout: 10_000 })
      await page.waitForTimeout(600)
      expect(await page.locator('[role=tab]').count()).toBe(0)
      await page.locator('[role=textbox], [contenteditable="true"]').first().click({ timeout: 5_000 })
      await page.evaluate(() => {
        const box = document.querySelector('[role=textbox], [contenteditable="true"]')
        if (box) {
          box.textContent = '/estela'
          box.dispatchEvent(new InputEvent('input', { bubbles: true, data: '/estela' }))
        }
      })
      await page.waitForTimeout(300)
      expect(await page.getByText('/estela', { exact: true }).count()).toBeLessThanOrEqual(1)

      // DSH-1: started seeded session shows Estela tab after Trajectory.
      const tabs = await openSidebarSession(page, 'Estela primary smoke')
      expect(tabs).toContain('Chat')
      expect(tabs).toContain('Trajectory')
      expect(tabs).toContain('Estela')
      expect(tabs.indexOf('Estela')).toBeGreaterThan(tabs.indexOf('Trajectory'))

      // DSH-2 + T25 + DSH-10: verify workspace, height bounds, redaction, and untouched <html>.
      const geometry = await readWorkspaceGeometry(page)
      expect(geometry.hasTimeline).toBe(true)
      expect(geometry.hasLedger).toBe(true)
      expect(geometry.hasInspector).toBe(true)
      expect(geometry.shadowText.includes('Export report')).toBe(false)
      expect(geometry.hasError).toBe(false)
      expect(geometry.shadowText.includes(mainFakeHome)).toBe(false)
      expect(geometry.shadowText.includes('~/projects/app')).toBe(true)
      expect(geometry.htmlDataTheme).toBeNull()
      if (geometry.composerTop !== null && geometry.elBottom !== null) {
        expect(geometry.elBottom).toBeLessThanOrEqual(geometry.composerTop + 1)
      }

      // Click a request row and confirm all 5 inspector tabs render cleanly.
      await page.locator('estela-workspace [data-testid="ledger"] [role=option]').nth(1).click({ timeout: 5_000 })
      await page.waitForTimeout(300)
      const inspectorTabs = await page
        .locator('estela-workspace [data-testid="inspector"] [role=tab]')
        .allTextContents()
      expect(inspectorTabs.join(' ')).toMatch(/Input.*Output.*Model saw.*Compare.*Raw/)
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
      expect(ownerCall.status).toBe(200)
      expect(z.parse(rpcEnvelopeSchema, JSON.parse(ownerCall.text)).result.ok).toBe(true)
    })
  })

  it('DSH-6: contains transport failure inside the Estela View and recovers via Try again without remounting', async () => {
    await withDshPage(browser!, activeDsh!.url, async page => {
      await openSidebarSession(page)

      await page.route('**/estela/**', async route => {
        await route.abort('failed')
      })

      await page.getByRole('tab', { name: 'Estela' }).click({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 10_000 })

      // Other dsh Views remain usable while Estela shows its error panel.
      await page.getByRole('tab', { name: 'Trajectory' }).click({ timeout: 5_000 })
      await page.waitForTimeout(300)
      await page.getByRole('tab', { name: 'Estela' }).click({ timeout: 5_000 })
      await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 10_000 })

      await page.evaluate(() => {
        document.querySelector('estela-workspace')?.setAttribute('data-smoke-instance', 'kept')
      })

      await page.unroute('**/estela/**')
      await page.getByRole('button', { name: 'Try again' }).click({ timeout: 5_000 })
      await page.getByTestId('ledger').waitFor({ timeout: 15_000 })

      const instanceTag = await page.evaluate(() =>
        document.querySelector('estela-workspace')?.getAttribute('data-smoke-instance'),
      )
      expect(instanceTag).toBe('kept')
      expect(await page.locator('estela-workspace [data-testid="error-panel"]').count()).toBe(0)
    })
  })

  it('DSH-9: keeps snapshot steady after appending a frame and shows the new turn after page reload', async () => {
    const appendedMarker = 'DSH9_APPENDED_MARKER_TEXT'
    await withDshPage(browser!, activeDsh!.url, async page => {
      await openSidebarSession(page, 'Estela primary smoke')
      expect((await readWorkspaceGeometry(page)).shadowText).not.toContain(appendedMarker)

      appendTurnFrame(primarySession!.logPath, {
        startSeq: primarySession!.lastSeq + 1,
        turn: primarySession!.lastTurn + 1,
        userText: appendedMarker,
      })
      await page.waitForTimeout(600)

      const afterAppend = await readWorkspaceGeometry(page)
      expect(afterAppend.shadowText).not.toContain(appendedMarker)
      expect(afterAppend.hasError).toBe(false)

      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForTimeout(1_000)
      await dismissNotices(page)
      await openSidebarSession(page, 'Estela primary smoke')

      await page.evaluate(() => {
        const ledger = document.querySelector('estela-workspace')?.shadowRoot?.querySelector('[data-testid="ledger"]')
        if (ledger) {
          ledger.scrollTop = ledger.scrollHeight
        }
      })
      await page.waitForTimeout(300)
      const reloaded = await readWorkspaceGeometry(page)
      expect(reloaded.shadowText).toContain(appendedMarker)
      expect(reloaded.hasError).toBe(false)
    })
  })

  it('DSH-7: loads a large session with virtualized ledger while keeping dsh session/list stall within budget', async () => {
    await withDshPage(browser!, activeDsh!.url, async (page, ctx) => {
      const cookieHeader = await cookieHeaderOf(ctx)
      const baselineLatencies: number[] = []
      for (let i = 0; i < 3; i += 1) {
        const res = await rpcPost(
          activeDsh!.port,
          '/api',
          'session/list',
          { args: { _request: {} } },
          { cookie: cookieHeader },
        )
        expect(res.status).toBe(200)
        expect(z.parse(rpcEnvelopeSchema, JSON.parse(res.text)).result.ok).toBe(true)
        baselineLatencies.push(res.ms)
      }
      const baselineMs = Math.min(...baselineLatencies)

      const opened = await rpcPost(
        activeDsh!.port,
        CHANNEL,
        'session/open',
        { sessionId: largeSession!.id },
        { cookie: cookieHeader },
      )
      expect(opened.status).toBe(200)
      const openParsed = z.parse(rpcEnvelopeSchema, JSON.parse(opened.text))
      expect(openParsed.result.ok).toBe(true)
      const { traceId } = z.parse(openValueSchema, openParsed.result.value)

      const loadPromise = rpcPost(activeDsh!.port, CHANNEL, 'trace/view', { traceId }, { cookie: cookieHeader })
      const probePromises = Array.from({ length: 5 }, () =>
        rpcPost(activeDsh!.port, '/api', 'session/list', { args: { _request: {} } }, { cookie: cookieHeader }),
      )
      const [viewRes, ...probeRes] = await Promise.all([loadPromise, ...probePromises])
      expect(viewRes.status).toBe(200)
      for (const probe of probeRes) {
        expect(probe.status).toBe(200)
        expect(z.parse(rpcEnvelopeSchema, JSON.parse(probe.text)).result.ok).toBe(true)
      }
      const maxConcurrentMs = Math.max(...probeRes.map(probe => probe.ms))
      const stallMs = Math.max(0, maxConcurrentMs - baselineMs)
      process.stdout.write(
        `DSH-7 stall: baseline=${baselineMs.toFixed(1)}ms maxConcurrent=${maxConcurrentMs.toFixed(1)}ms stall=${stallMs.toFixed(1)}ms viewLoad=${viewRes.ms.toFixed(1)}ms viewBytes=${viewRes.text.length} budget=${DSH_LOAD_STALL_MS}ms\n`,
      )
      expect(stallMs).toBeLessThan(DSH_LOAD_STALL_MS)

      await openSidebarSession(page, 'Estela large smoke')
      const layout = await readWorkspaceGeometry(page)
      expect(layout.renderedRows).toBeGreaterThan(0)
      expect(layout.renderedRows).toBeLessThan(100)
      expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight * 3)
      if (layout.composerTop !== null && layout.elBottom !== null) {
        expect(layout.elBottom).toBeLessThanOrEqual(layout.composerTop + 1)
      }
    })
  })

  it('DSH-11: follows light theme and Chinese locale configured via cordis.patch.yml without writing <html>', async () => {
    await activeDsh!.stop()
    activeDsh = undefined

    await writeFile(
      join(mainDshHome, 'profiles/web/cordis.patch.yml'),
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

    activeDsh = await startDshWeb(dshBin, mainEnv, trackedPids)
    await withDshPage(
      browser!,
      activeDsh.url,
      async page => {
        await openSidebarSession(page, 'Estela primary smoke')
        const state = await readWorkspaceGeometry(page)
        expect(state.theme).toBe('light')
        expect(state.lang).toBe('zh-CN')
        expect(state.htmlDataTheme).toBeNull()
        expect(
          state.shadowText.includes('会话')
            || state.shadowText.includes('时间线')
            || state.shadowText.includes('全部事件'),
        ).toBe(true)
        expect(state.shadowText).toContain('inspect secret path')
      },
      'zh-CN',
    )
  })

  it('DSH-12: uninstalling while dsh web runs removes the tab, returns 405 on the channel, and leaves no sockets or files', async () => {
    try {
      await withDshPage(browser!, activeDsh!.url, async (page, ctx) => {
        await openSidebarSession(page)
        await page.getByRole('tab', { name: 'Estela' }).waitFor({ timeout: 10_000 })

        const cookieHeader = await cookieHeaderOf(ctx)
        const portsBefore = await listListeningPorts(activeDsh!.pid)
        expect(portsBefore.length).toBeGreaterThan(0)

        const removed = await runDshCli(dshBin, ['plugin', '--profile', 'web', 'remove', '@rivus/dsh-estela'], mainEnv)
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

        const profilePkg = z.parse(
          profilePkgSchema,
          JSON.parse(await readFile(join(mainDshHome, 'profiles/web/package.json'), 'utf8')),
        )
        expect(profilePkg.dependencies?.['@rivus/dsh-estela']).toBeUndefined()
        expect(profilePkg.dsh.profile.bundles).not.toContain('@rivus/dsh-estela')
        expect(existsSync(join(mainDshHome, 'profiles/web/node_modules/@rivus/dsh-estela'))).toBe(false)
      })
    } finally {
      await activeDsh!.stop()
      activeDsh = undefined
    }
  })

  it('DSH-13: refuses installing an incompatible tarball and disables a pre-installed incompatible copy at startup', async () => {
    const incompatDir = join(rootTmp, 'dsh-incompat')
    const incompatHome = join(incompatDir, 'dsh-home')
    const incompatFakeHome = join(incompatDir, 'fake-home')
    await mkdir(incompatHome, { recursive: true })
    await mkdir(incompatFakeHome, { recursive: true })
    const incompatEnv = createDshEnv(incompatHome, incompatFakeHome)

    const badTarball = await repackWithEnginesDsh(tarball, '>=99', incompatDir)
    const refused = await runDshCli(dshBin, ['plugin', '--profile', 'web', 'add', badTarball], incompatEnv)
    expect(refused.exitCode).toBe(1)
    expect(refused.stderr + refused.stdout).toMatch(/incompatible/i)
    expect(refused.stderr + refused.stdout).toContain('dsh plugin allow-version')

    const installed = await runDshCli(dshBin, ['plugin', '--profile', 'web', 'add', tarball], incompatEnv)
    expect(installed.exitCode).toBe(0)

    const initDsh = await startDshWeb(dshBin, incompatEnv, trackedPids)
    try {
      await withDshPage(browser!, initDsh.url, async () => {})
    } finally {
      await initDsh.stop()
    }

    const wsPath = await readWorkspacePath(incompatHome)
    seedSession({ home: incompatHome, cwd: wsPath, title: 'Incompat startup check' })

    const installedPkgPath = join(incompatHome, 'profiles/web/node_modules/@rivus/dsh-estela/package.json')
    const installedPkg = z.parse(
      z.looseObject({ engines: z.looseObject({ dsh: z.string() }) }),
      JSON.parse(await readFile(installedPkgPath, 'utf8')),
    )
    installedPkg.engines.dsh = '>=99'
    await writeFile(installedPkgPath, `${JSON.stringify(installedPkg, null, 2)}\n`, 'utf8')

    const incompatDsh = await startDshWeb(dshBin, incompatEnv, trackedPids)
    try {
      await withDshPage(browser!, incompatDsh.url, async page => {
        const tabs = await openSidebarSession(page)
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
