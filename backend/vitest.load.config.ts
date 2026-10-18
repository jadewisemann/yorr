import { defineConfig } from 'vitest/config'

/**
 * 부하 측정(`test/load`). 정확성이 아니라 **응답성**을 본다 — 수십 초를 쓰므로 PR이 아니라
 * 야간 실행과 수동 측정에서 돈다. 블랙박스 스위트처럼 `E2E_BASE_URL`이면 배포된 번들을 두드린다.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/load/**/*.load.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000,
  },
})
