import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:4306',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
    // 랜딩·게임 화면은 760px/1024px에서 마크업이 통째로 갈린다.
    // 모바일 프로젝트만으로는 넓은 레이아웃 코드가 브라우저에서 한 번도 실행되지 않는다.
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node e2e/preview-server.mjs',
    url: 'http://127.0.0.1:4306',
    reuseExistingServer: false,
  },
})
