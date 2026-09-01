import { coverageConfigDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',

      reporter: ['text-summary', 'json', 'json-summary'],

      include: ['src/**/*.ts'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // 프로세스 진입점 — 부팅 순서만 있고 분기가 없다. 테스트가 이 파일을
        // 부르면 서버가 실제로 뜬다.
        'src/main.ts',
        'src/migrate.ts',
        // 테스트 하네스 자신. `__tests__/` 아래이지만 `*.test.ts`가 아니라서
        // 기본 제외에 걸리지 않는다.
        'src/**/__tests__/**',
      ],
    },
  },
})
