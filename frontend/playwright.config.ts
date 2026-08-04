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
    // styles/global.css가 html·body에 min-width: 320px을 박아 320px을 지원 하한으로
    // 선언했는데, Pixel 7(412px)·iPhone 15(393px)만으로는 **그 하한을 한 번도 보지 않는다.**
    // 한글은 어절 중간에서 끊기고 긴 라벨은 넘치는데, 가장 잘 깨지는 폭이 검증 밖에 있었다.
    // 크기는 iPhone SE 1세대(320×568) — 브라우저가 실제로 존재하는 가장 좁은 폭이다.
    //
    // 다만 기기 프로필은 **Pixel 7(Chromium)**을 쓴다. devices['iPhone SE']는
    // defaultBrowserType이 webkit인 프로필이라, 브라우저를 지정하지 않은 이 프로젝트에서는
    // "사파리 UA를 뒤집어쓴 크로미움"으로 돌아간다 — 그 조합에서 화면 전환(view transition)이
    // 겹칠 때 **렌더러가 죽었다**(invalid-invite·smoke 3건이 그렇게 실패하고 있었다).
    // 실제 사파리는 mobile-safari 프로젝트가 본다. 여기서 보려는 것은 폭이다.
    {
      name: 'mobile-320',
      use: { ...devices['Pixel 7'], viewport: { width: 320, height: 568 } },
    },
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
