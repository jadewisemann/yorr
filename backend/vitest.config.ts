import { defineConfig } from 'vitest/config'

/**
 * 커버리지는 **래칫**이다 — 바닥은 실측값을 내림한 값이고 올릴 수만 있다(루트 TESTING.md).
 * MySQL 통합 테스트는 `MYSQL_TEST_URL`이 있을 때만 돌아서 저장소 코드만큼 수치가 달라진다.
 * 그래서 바닥을 환경별로 둔다 — CI는 MySQL을 켜고 돈다.
 */
const floor = process.env.MYSQL_TEST_URL
  ? { statements: 89.4, branches: 82, functions: 88.1, lines: 91.3 }
  : { statements: 90, branches: 82.3, functions: 88.6, lines: 91.9 }

/** 지금 100%인 핵심 규칙 모듈 — 절대 기준으로 묶는다(QUALITY.md 3-(c)). 목록은 늘리기만 한다. */
const FULLY_COVERED = [
  'src/game/catalog.ts',
  'src/game/lifecycle.ts',
  'src/game/ranking/weekBoundary.ts',
  'src/game/round/roundSubmission.ts',
  'src/game/score/scoreCategory.ts',
  'src/game/score/yachtScoreCalculator.ts',
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
