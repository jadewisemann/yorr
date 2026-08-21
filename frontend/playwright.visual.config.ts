import { defineConfig, devices } from '@playwright/test'

/**
 * 시각 대조 — `/__dev/components` 카탈로그의 프리미티브를 섹션 단위로 찍어 두고
 * 스타일 변경 전후를 비교한다. `playwright.config.ts`(동작 E2E)와는 별개다.
 *
 * **회귀 테스트가 아니라 대조 도구다.** baseline은 저장소에 넣지 않는다 — 프론트 CI
 * (`.github/workflows/frontend.yml`)는 check·typecheck·test·build·cycles만 돌리고
 * Playwright를 실행하지 않으므로 CI가 지켜 줄 baseline이 없고, 폰트 렌더링은 기기마다
 * 달라 남의 기계에서 뜬 이미지는 전부 어긋난다. 대신 **한 기계 안에서 before/after**를
 * 본다 (사용법은 docs/llmwiki/testing.md).
 *
 * 프로덕션 빌드가 아니라 vite dev 서버를 띄우는 이유: 카탈로그가
 * `import.meta.env.DEV` 게이트 안에 있어 빌드 산출물에는 없다.
 */
export default defineConfig({
  testDir: './e2e/visual',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // 재시도는 diff를 감춘다 — 두 번째 실행이 우연히 통과하면 변경을 못 본다.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  // **`threshold`가 진짜 손잡이다.** Playwright의 기본 `threshold: 0.2`는 픽셀 하나의
  // 색 거리(YIQ) 허용치라, `maxDiffPixels`를 0으로 조여도 헤어라인 알파 1%p 차이
  // (#111214 위 15% → 14% = 채널 3/255)는 "같은 픽셀"로 세어 아예 실패하지 않는다.
  // 실측: 그 상태로 GameChromeButton 15→14·20→18% 변경이 통과했다. 이 도구가 보려는
  // 것이 정확히 그 차이라 둘 다 0으로 둔다 — 같은 기계·같은 실행이면 나머지 11개
  // 섹션은 비트 단위로 같아서 오탐이 나지 않는다(실측).
  expect: { toHaveScreenshot: { threshold: 0, maxDiffPixels: 0 } },
  use: {
    baseURL: 'http://127.0.0.1:5310',
    // 색만 보는 도구라 뷰포트를 늘리지 않는다 — 레이아웃 회귀는 동작 E2E의 몫이다.
    ...devices['Desktop Chrome'],
    // 테마를 고정한다. `index.html`의 프리페인트 스크립트가 `prefers-color-scheme`을
    // 따르므로, 고정하지 않으면 **기계의 OS 설정에 따라 다크/라이트가 갈려** 기준
    // 이미지가 통째로 어긋난다(실측: 이 컨테이너의 헤드리스 크로미움은 light를 선호한다).
    colorScheme: 'dark',
  },
  projects: [{ name: 'catalog' }],
  webServer: {
    command: 'npx vite --port 5310 --strictPort',
    url: 'http://127.0.0.1:5310',
    reuseExistingServer: false,
  },
})
