import react from '@vitejs/plugin-react'
import { coverageConfigDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': '/src' },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // 기본 5000ms는 setup.ts의 asyncUtilTimeout(5000)과 같아, 쿼리가 대기를 다 쓰면
    // 어떤 DOM을 봤는지 알려주는 RTL 오류 대신 밋밋한 "test timed out"이 뜬다.
    testTimeout: 20_000,
    // RAPIER wasm 초기화(World.test.ts)는 부하가 걸리면 기본 10000ms를 넘긴다.
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      // lcov·json-summary 는 CI·후속 도구(리포트 코멘트, ratchet 스크립트) 연계용.
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // 테스트가 import한 파일만 세면 한 번도 실행되지 않은 소스가 분모에서 빠진다.
      // 전체 src를 기준으로 재야 수치가 실제 안전망 크기를 말해 준다.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        // mock 인프라(MSW 핸들러·픽스처)는 제품 코드가 아니라 분모에서 뺀다.
        'src/mocks/**',
        // 개발 전용 내부 도구 UI — 제품 코드가 아니라 분모에서 뺀다. 근거는 .dev.md 참고.
        'src/app/dev/**',
      ],
      // ratchet 방식: 실측값(statements 96.31 · branches 91.47 · functions 97 · lines 98.4,
      // develop 병합·커버리지 보강 직후 재측정)에서 소폭 여유를 둔 하한.
      // 커버리지가 오르면 임계값도 따라 올린다. 내려가는 변경은 CI 에서 막는다.
      thresholds: {
        statements: 96,
        branches: 91,
        functions: 96,
        lines: 98,
      },
    },
  },
})
