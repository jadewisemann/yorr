import { defineConfig } from 'vitest/config'

/**
 * 커버리지는 **래칫**이다 — 바닥은 실측값을 내림한 값이고 올릴 수만 있다(루트 TESTING.md).
 * 이제 모든 통합 테스트가 어디서나 돈다(저장소·DB가 프로세스 안이다) — 바닥이 하나다.
 * 실측: 2026-10-18(ADR-0007 이후), 2026-10-21 갱신(경계값·전수 대조 하네스 도입).
 */
const floor = { statements: 94, branches: 87, functions: 94.6, lines: 96.2 }

/** 지금 100%인 핵심 규칙 모듈 — 절대 기준으로 묶는다(QUALITY.md 3-(c)). 목록은 늘리기만 한다. */
const FULLY_COVERED = [
  'src/game/catalog.ts',
  'src/game/delegatingGameModule.ts',
  'src/game/lifecycle.ts',
  'src/game/pingpong/pingPongCourtMath.ts',
  'src/game/ranking/weekBoundary.ts',
  'src/game/round/roundSubmission.ts',
  'src/game/score/scoreCategory.ts',
  'src/game/score/yachtScoreCalculator.ts',
  'src/game/yacht/payloads.ts',
  'src/http/headers.ts',
]

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // 진입점 둘은 부팅 배선뿐이다 — 단위 테스트가 아니라 실제 기동이 검증한다.
      exclude: ['src/**/__tests__/**', 'src/main.ts', 'src/migrate.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      thresholds: {
        ...floor,
        ...Object.fromEntries(FULLY_COVERED.map((file) => [file, { 100: true }])),
      },
    },
  },
})
