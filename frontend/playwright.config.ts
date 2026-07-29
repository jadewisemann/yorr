import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // e2e/support/*.ts는 공용 하네스다. 기본 testMatch도 걸러내지만,
  // 스펙이 아닌 파일이 생긴 뒤로는 규칙을 눈에 보이게 적어 둔다.
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // html 리포터의 기본값(open: 'on-failure')은 실패한 로컬 실행 뒤에 리포트 서버를 띄우고
  // 프로세스를 붙잡는다 — `npm run test:e2e`가 그대로 멈춘다. 진행 상황은 list로 보고,
  // 리포트는 파일로만 남긴다(npx playwright show-report).
  reporter: [['list'], ['html', { open: 'never' }]],
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
