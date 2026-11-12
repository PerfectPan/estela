import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

// `test:e2e` only: it packs and installs the CLI, so it is not part of the root `pnpm test`.
// Chromium only. `ESTELA_E2E_CHANNEL=chrome` uses the installed Google Chrome
// instead of Playwright's download, for machines that cannot fetch it.
const channel = process.env.ESTELA_E2E_CHANNEL

export default defineConfig({
  testDir: 'src/e2e',
  testMatch: '*.e2e.ts',
  globalSetup: './src/e2e/global-setup.ts',
  // One at a time: S8 measures long tasks and S12 loads 350 MB, so nothing else should compete.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    ...devices['Desktop Chrome'],
    ...(channel ? { channel } : {}),
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
})
