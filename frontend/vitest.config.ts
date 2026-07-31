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
        'src/app/DevCatalog.tsx',
        'src/app/PhysicsDiceDemo.tsx',
        'src/app/MotionLab*.tsx',
        'src/app/useMotionLab.ts',
      ],
      // ratchet 방식: 실측값(statements 97.61 · branches 92.84 · functions 99.46 · lines 99.46,
      // frontend/test/add-e2e-and-coverage 병합 직후 재측정)에서 소폭 여유를 둔 하한.
      // 커버리지가 오르면 임계값도 따라 올린다. 내려가는 변경은 CI 에서 막는다.
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 97,
        lines: 97,
      },
    },
  },
})
