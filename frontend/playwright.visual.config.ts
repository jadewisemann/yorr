import { defineConfig, devices } from '@playwright/test'

/**
 * 시각 대조 — `/__dev/components` 카탈로그의 프리미티브를 섹션 단위로 찍어 두고
 * 스타일 변경 전후를 비교한다. `playwright.config.ts`(동작 E2E)와는 별개다.
 *
 * **회귀 테스트가 아니라 대조 도구다.** baseline은 저장소에 넣지 않는다 —
 * Jenkins 프론트 스테이지는 check·typecheck·test·build만 돌리고 Playwright를 아예
 * 실행하지 않으므로 CI가 지켜 줄 baseline이 없고, 폰트 렌더링은 기기마다 달라
 * 남의 기계에서 뜬 이미지는 전부 어긋난다. 대신 **한 기계 안에서 before/after**를
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
  // 색 회수 작업이 노리는 것은 알파 한두 단 차이라 임계값을 두면 안 보인다.
  // 안티앨리어싱 몫만 열어 둔다.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002 } },
  use: {
    baseURL: 'http://127.0.0.1:5310',
    // 색만 보는 도구라 뷰포트를 늘리지 않는다 — 레이아웃 회귀는 동작 E2E의 몫이다.
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'catalog' }],
  webServer: {
    command: 'npx vite --port 5310 --strictPort',
    url: 'http://127.0.0.1:5310',
    reuseExistingServer: false,
  },
})
