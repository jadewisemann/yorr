import { defineConfig, devices } from '@playwright/test'

const isReal = process.env.E2E_TARGET === 'real'

export default defineConfig({
  testDir: isReal ? './e2e/real' : './e2e/mock',

  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,

  reporter: [['list'], ['html', { open: 'never' }]],
  ...(isReal && {
    globalSetup: './e2e/support/checkBackend.ts',

    expect: { timeout: 10_000 },
  }),
  use: {
    baseURL: 'http://127.0.0.1:4306',
    trace: 'on-first-retry',

    colorScheme: 'dark',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },

    {
      name: 'mobile-320',
      use: { ...devices['Pixel 7'], viewport: { width: 320, height: 568 } },
    },

    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node e2e/preview-server.mjs',
    url: 'http://127.0.0.1:4306',
    reuseExistingServer: false,
  },
})
