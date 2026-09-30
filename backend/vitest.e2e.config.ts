import { defineConfig } from 'vitest/config'

/**
 * 블랙박스 스위트(`test/blackbox`). 단위 스위트와 설정을 나눈 이유: 같은 테스트를 배포
 * 리허설이 **실제 컨테이너**에 대고 다시 돌린다(`E2E_BASE_URL`) — 저장소 루트 TESTING.md.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/blackbox/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
