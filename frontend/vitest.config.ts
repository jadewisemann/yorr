import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

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
      include: ['src/**'],
      exclude: [
        'src/mocks/**',
        'src/test/**',
        'src/**/*.test.*',
        'src/vite-env.d.ts',
        'src/main.tsx',
      ],
      // ratchet 방식: 2026-07-29 측정값(52.6/61.05/64.97/54.05)에서 소폭 여유를 둔 하한.
      // 커버리지가 오르면 임계값도 따라 올린다. 내려가는 변경은 CI 에서 막는다.
      // rendering(three.js·rapier)은 jsdom 에서 의미 있는 측정이 안 돼 전체 평균을 낮춘다 — .dev.md 참고.
      thresholds: {
        statements: 50,
        branches: 59,
        functions: 62,
        lines: 52,
      },
    },
  },
})
