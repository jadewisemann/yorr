import { defineConfig, devices } from '@playwright/test'

/**
 * E2E 는 두 모드로 돈다.
 * - mock(기본): 서버 없이 프로덕션 빌드의 UI 계약만 검증한다. (e2e/mock)
 * - real(E2E_TARGET=real): 실제 백엔드가 필요한 사용자 흐름을 검증한다. (e2e/real)
 *   시작 전 globalSetup 이 백엔드 도달 여부를 확인하고, 미기동이면 즉시 실패한다.
 */
const isReal = process.env.E2E_TARGET === 'real'

export default defineConfig({
  testDir: isReal ? './e2e/real' : './e2e/mock',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  ...(isReal && {
    globalSetup: './e2e/support/checkBackend.ts',
    // 실서버 WS 브로드캐스트 지연을 감안해 mock(기본 5s)보다 길게 기다린다.
    expect: { timeout: 10_000 },
  }),
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
