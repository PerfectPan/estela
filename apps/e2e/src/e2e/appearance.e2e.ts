import { activePanel, ctx, expect, openWorkspace, test } from './harness.ts'

test.describe('S11: theme', () => {
  test.use({ colorScheme: 'light' })

  test('the first load follows the light system scheme; a switch to dark survives a reload', async ({ page, launch }) => {
    await openWorkspace(page, launch, ctx.homes.sessions.claudePlain)
    const root = page.locator('html')
    await expect(root).toHaveAttribute('data-theme', 'light')
    const toggle = page.getByTestId('theme-switch')
    // system → light → dark
    await toggle.click()
    await toggle.click()
    await expect(toggle).toHaveAttribute('data-mode', 'dark')
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await page.reload()
    await expect(page.getByTestId('ledger')).toBeVisible()
    await expect(root).toHaveAttribute('data-theme', 'dark')
  })
})

test.describe('S14: language', () => {
  test.use({ locale: 'zh-CN' })

  test('zh-CN shows Chinese labels and dates, keeps session text, and English survives a reload', async ({ page, launch }) => {
    await openWorkspace(page, launch, ctx.homes.sessions.claudeCompaction)
    const root = page.locator('html')
    const header = page.locator('section').first()
    const promptText = async (kind: string) => {
      await page.locator('[role=option]').filter({ hasText: kind }).first().click()
      return activePanel(page).getByTestId('inspector-body').innerText()
    }
    await expect(root).toHaveAttribute('lang', 'zh-CN')
    await expect(page.getByText('时间线', { exact: true })).toBeVisible()
    // `Intl` in zh-CN writes dates as `1月1日周四 08:00`.
    await expect(header).toContainText(/\d+月\d+日/)
    const title = await header.getAttribute('aria-label')
    const prompt = await promptText('用户')

    await page.getByTestId('language-switch').click()
    await expect(root).toHaveAttribute('lang', 'en')
    await page.reload()
    await expect(page.getByTestId('ledger')).toBeVisible()
    await expect(root).toHaveAttribute('lang', 'en')
    await expect(page.getByText('Timeline', { exact: true })).toBeVisible()
    await expect(header).not.toContainText(/\d+月\d+日/)
    // Session text is shown as recorded in both languages.
    expect(await header.getAttribute('aria-label')).toBe(title)
    expect(await promptText('USER')).toBe(prompt)
  })
})
