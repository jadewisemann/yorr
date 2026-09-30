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

    testTimeout: 20_000,

    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',

      reporter: ['text', 'html', 'lcov', 'json-summary'],

      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',

        'src/mocks/**',

        'src/app/dev/DevCatalog.tsx',
        'src/app/dev/PhysicsDiceDemo.tsx',
        'src/app/dev/MotionLab*.tsx',
        'src/app/dev/useMotionLab.ts',
        'src/app/dev/HandVoiceLab.tsx',

        'src/yacht/rendering/physics-dice/World.ts',
      ],

      // 래칫 — 실측을 내림한 바닥이고 올릴 수만 있다(루트 TESTING.md). CI가 강제한다.
      // 이전 값(96·91·96·98)은 CI가 `npm test`만 돌아 한 번도 검사되지 않았고, 그사이
      // 결투·탁구 3D가 테스트 없이 들어와 실측이 82·77·85·83까지 내려가 있었다(2026-09-30).
      // CI(러너)와 로컬은 함수 수에서 0.3%p쯤 갈린다(타이밍에 걸린 경로) — 낮은 쪽을 바닥으로 둔다.
      thresholds: {
        statements: 82.3,
        branches: 77.1,
        functions: 84.8,
        lines: 83.8,
      },
    },
  },
})
