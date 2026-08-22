import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/visual',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),

  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  expect: { toHaveScreenshot: { threshold: 0, maxDiffPixels: 0 } },
  use: {
    baseURL: 'http://127.0.0.1:5310',

    ...devices['Desktop Chrome'],

    colorScheme: 'dark',
  },
  projects: [{ name: 'catalog' }],
  webServer: {
    command: 'npx vite --port 5310 --strictPort',
    url: 'http://127.0.0.1:5310',
    reuseExistingServer: false,
  },
})
